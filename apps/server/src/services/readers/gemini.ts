// Google Gemini through the Interactions API, always answering with JSON.
// https://ai.google.dev/gemini-api/docs/interactions
import { z } from "zod";
import { ReaderError } from "./errors";
import type { UsageCounter } from "./usage";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";
export const GEMINI_TIMEOUT_MS = 30_000;
/** Waits before trying again when Google answers "high demand" or has an error. */
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
  usage: UsageCounter;
  fetch?: typeof fetch;
  timeoutMs?: number;
  busyRetryDelaysMs?: number[];
}

export function createGemini(options: GeminiOptions) {
  const { apiKey, model, usage, timeoutMs = GEMINI_TIMEOUT_MS } = options;
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

  async function send(body: string): Promise<string> {
    let networkRetried = false;
    for (let busy = 0; ;) {
      try {
        return await attempt(body);
      } catch (error) {
        const code = error instanceof ReaderError ? error.code : undefined;
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

  return {
    model,
    /**
     * Asks for JSON in the shape of `schema` (JSON Schema) and checks it with `validate`.
     * Nothing is stored at Google ("store: false"): invoices stay out of their history.
     */
    async generateJson<T>(request: {
      parts: GeminiPart[];
      schema: object;
      validate: z.ZodType<T>;
    }): Promise<T> {
      if (!apiKey) throw fail("NOT_CONFIGURED", "GEMINI_API_KEY is not set");
      const text = await send(
        JSON.stringify({
          model,
          store: false,
          input: request.parts,
          response_format: { type: "text", mime_type: "application/json", schema: request.schema },
        }),
      );
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw fail("BAD_ANSWER", "the answer was not JSON");
      }
      const result = request.validate.safeParse(json);
      if (!result.success) throw fail("BAD_ANSWER", "the JSON did not have the asked shape");
      return result.data;
    },
  };
}

export type Gemini = ReturnType<typeof createGemini>;
