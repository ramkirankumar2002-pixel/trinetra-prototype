// Pretend Plate Recognizer and Gemini for tests. Nothing leaves the computer.

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A Plate Recognizer answer: plates(["mh12ab1234", 0.9], ...) */
export const plates = (...results: [plate: string, score: number][]) =>
  json({ results: results.map(([plate, score]) => ({ plate, score, dscore: 0.8 })) }, 201);

/** A Gemini Interactions answer whose model output is `text`. */
export const geminiText = (text: string) =>
  json({
    id: "test",
    status: "completed",
    steps: [
      { type: "user_input", content: [{ type: "text", text: "the question" }] },
      { type: "model_output", content: [{ type: "text", text }] },
    ],
  });

/** What a service does for its nth request. "hang" never answers (until aborted). */
type Handler = (n: number, call: FakeCall) => Response | Promise<Response> | "hang";

export interface FakeCall {
  url: string;
  headers: Headers;
  body: unknown;
}

export function fakeApis(handlers: { plateRecognizer?: Handler; gemini?: Handler }) {
  const calls = { plateRecognizer: [] as FakeCall[], gemini: [] as FakeCall[] };

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const service = url.includes("platerecognizer.com") ? "plateRecognizer" : "gemini";
    const call = { url, headers: new Headers(init?.headers), body: init?.body };
    calls[service].push(call);
    const handler = handlers[service];
    if (!handler) throw new Error(`The test did not expect a call to ${service}.`);
    const answer = handler(calls[service].length, call);
    if (answer !== "hang") return answer;
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    });
  }) as typeof fetch;

  return { fetch: fakeFetch, calls };
}
