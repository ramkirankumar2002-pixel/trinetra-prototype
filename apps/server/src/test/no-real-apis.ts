// Runs before every test file: tests must never spend API quota or send data out.
import { loadEnvFile } from "../config/paths";

loadEnvFile();
// Even a test that forgets to mock has no key to use...
delete process.env.PLATE_RECOGNIZER_TOKEN;
delete process.env.GEMINI_API_KEY;

// ...and cannot reach the services.
const BLOCKED = ["platerecognizer.com", "googleapis.com"];
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (BLOCKED.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return Promise.reject(new Error(`A test tried to call the real API at ${url.hostname}.`));
  }
  return realFetch(input, init);
};
