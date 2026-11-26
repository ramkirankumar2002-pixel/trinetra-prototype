// Google Gemini through the Interactions API, always answering with JSON.
// https://ai.google.dev/gemini-api/docs/interactions
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { ReaderError } from "./errors";
import type { UsageCounter } from "./usage";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";
export const GEMINI_TIMEOUT_MS = 30_000;
/** Failures of the main model that are worth asking the backup model about. */
const BACKUP_REASONS: ReadonlySet<ReaderError["code"]> = new Set([
  "BUSY",
  "RATE_LIMITED",
  "TIMEOUT",
]);
/** Without a backup: waits before trying again when Google answers "high demand". */
const BUSY_RETRY_DELAYS_MS = [1500, 4000];

const answerSchema = z.object({
  status: z.string().optional(),
  steps: z.array(
    z.object({
      type: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});

export type GeminiPart =
  { type: "text"; text: string } | { type: "image" | "document"; mime_type: string; data: string };

export function filePart(data: Buffer, contentType: string): GeminiPart {
  return {
    type: contentType === "application/pdf" ? "document" : "image",
    mime_type: contentType,
    data: data.toString("base64"),
  };
}

export interface GeminiOptions {
  apiKey: string | undefined;
  model: string;
  /** Asked once if the main model is busy, rate limited or too slow. Same name = none. */
  fallbackModel?: string;
  usage: UsageCounter;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
  fetch?: typeof fetch;
  timeoutMs?: number;
  busyRetryDelaysMs?: number[];
}

export function createGemini(options: GeminiOptions) {
  const { apiKey, model, usage, log, timeoutMs = GEMINI_TIMEOUT_MS } = options;
  const backup = options.fallbackModel === model ? undefined : options.fallbackModel;
  const delays = options.busyRetryDelaysMs ?? BUSY_RETRY_DELAYS_MS;
  const fail = (code: ReaderError["code"], message: string) =>
    new ReaderError("gemini", code, message);

  /** The service's own explanation, cut short, with the key removed in case it is echoed. */
  async function explanation(response: Response): Promise<string> {
    const body = (await response.json().catch(() => undefined)) as
      { error?: { message?: string } } | undefined;
    const message = body?.error?.message ?? "";
    return `HTTP ${response.status} ${message.replaceAll(apiKey!, "[key]").slice(0, 200)}`.trim();
  }

  async function attempt(body: string): Promise<string> {
    await usage.record("gemini");
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // In a header, never in the address, which could end up in a log.
          "x-goog-api-key": apiKey!,
          "api-revision": API_REVISION,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw (error as Error).name === "TimeoutError"
        ? fail("TIMEOUT", `no answer within ${timeoutMs} ms`)
        : fail("NETWORK", "could not reach the service");
    }
    if (!response.ok) {
      const code =
        response.status === 429
          ? "RATE_LIMITED"
          : response.status === 401 || response.status === 403
            ? "AUTH_OR_CREDITS"
            : response.status >= 500
              ? "BUSY"
              : "REQUEST_REFUSED";
      throw fail(code, await explanation(response));
    }

    const parsed = answerSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw fail("BAD_ANSWER", "unexpected answer");
    const text = parsed.data.steps
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .map((content) => (content.type === "text" ? (content.text ?? "") : ""))
      .join("");
    if (!text) throw fail("BAD_ANSWER", `no text in the answer (${parsed.data.status ?? "?"})`);
    return text;
  }

  /** One model, with its own retries. */
  async function send(body: string, hasBackup: boolean): Promise<string> {
    let networkRetried = false;
    for (let busy = 0; ;) {
      try {
        return await attempt(body);
      } catch (error) {
        const code = error instanceof ReaderError ? error.code : undefined;
        // With a backup, waiting on a model that is busy or slow only delays the driver.
        if (hasBackup && code && BACKUP_REASONS.has(code)) throw error;
        if (code === "BUSY" && busy < delays.length) {
          await new Promise((resolve) => setTimeout(resolve, delays[busy++]));
        } else if ((code === "NETWORK" || code === "TIMEOUT") && !networkRetried) {
          networkRetried = true;
        } else {
          throw error;
        }
      }
    }
  }

  /** The main model, then once on the backup. Says which of them answered. */
  async function ask(bodyFor: (name: string) => string): Promise<{ text: string; model: string }> {
    try {
      return { text: await send(bodyFor(model), backup !== undefined), model };
    } catch (error) {
      if (!backup || !(error instanceof ReaderError) || !BACKUP_REASONS.has(error.code)) {
        throw error;
      }
      log?.warn(
        { model, backupModel: backup, reason: error.code, detail: error.message },
        "Gemini: trying the backup model",
      );
      try {
        return { text: await attempt(bodyFor(backup)), model: backup };
      } catch (backupError) {
        if (backupError instanceof ReaderError) {
          log?.warn(
            { model: backup, reason: backupError.code, detail: backupError.message },
            "Gemini: the backup model failed too",
          );
        }
        throw backupError;
      }
    }
  }

  return {
    model,
    fallbackModel: backup,
    /**
     * Asks for JSON in the shape of `schema` (JSON Schema) and checks it with `validate`.
     * Returns the data and the name of the model that answered.
     * Nothing is stored at Google ("store: false"): invoices stay out of their history.
     */
    async generateJson<T>(request: {
      parts: GeminiPart[];
      schema: object;
      validate: z.ZodType<T>;
    }): Promise<{ data: T; model: string }> {
      if (!apiKey) throw fail("NOT_CONFIGURED", "GEMINI_API_KEY is not set");
      const answer = await ask((name) =>
        JSON.stringify({
          model: name,
          store: false,
          input: request.parts,
          response_format: { type: "text", mime_type: "application/json", schema: request.schema },
        }),
      );
      log?.info({ model: answer.model, backup: answer.model !== model }, "Gemini: answer received");
      let json: unknown;
      try {
        json = JSON.parse(answer.text);
      } catch {
        throw fail("BAD_ANSWER", `the answer from ${answer.model} was not JSON`);
      }
      const result = request.validate.safeParse(json);
      if (!result.success) {
        throw fail("BAD_ANSWER", `the JSON from ${answer.model} did not have the asked shape`);
      }
      return { data: result.data, model: answer.model };
    },
  };
}

export type Gemini = ReturnType<typeof createGemini>;
