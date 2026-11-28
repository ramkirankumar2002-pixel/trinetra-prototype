// A pretend weighbridge: the main ESP32 and both ESP32-CAMs, speaking the firmware's
// protocol.
//   pnpm sim                 cameras send the matching plate pair
//   pnpm sim --mismatch      the back camera shows another plate
//   pnpm sim --loaded 19150  what the loaded truck of key "a" weighs
//   pnpm sim --scale 40      use this "1 g = X kg" instead of asking the backend
//   pnpm sim --url ws://host:4000/device
// The device tokens come from apps/server/.env. Start the backend first.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CAMERA_IDS,
  DEFAULT_MODEL_SCALE,
  formatKg,
  MAX_MODEL_SCALE,
  TAMPER_REASONS,
  type DemoSettings,
} from "@trinetra/shared";
import { SEED_USERS } from "@trinetra/shared/seed";
import { SimCamera, SimMainBoard } from "./sim/board";
import { EMPTY_KG, LOADED_KG } from "./sim/weight-model";

const OFFLINE_FOR_MS = 5000;

const envFile = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    url: { type: "string" },
    mismatch: { type: "boolean", default: false },
    loaded: { type: "string" },
    scale: { type: "string" },
  },
});
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const loadedKg = args.loaded === undefined ? LOADED_KG : Number(args.loaded);
if (!Number.isInteger(loadedKg) || loadedKg <= 0 || loadedKg > 200_000) {
  fail("--loaded takes a whole number of kilograms, such as 19150.");
}
const kgPerGram = args.scale === undefined ? DEFAULT_MODEL_SCALE : Number(args.scale);
if (!(kgPerGram > 0 && kgPerGram <= MAX_MODEL_SCALE)) {
  fail(`--scale takes the kilograms for 1 gram, up to ${MAX_MODEL_SCALE}.`);
}
const url = args.url ?? process.env.SIM_SERVER_URL ?? "ws://localhost:4000/device";
const httpBase = url.replace(/^ws/, "http").replace(/\/device$/, "");
let mismatch = args.mismatch;

function token(name: string): string {
  return process.env[name] || fail(`${name} is not set in apps/server/.env (see .env.example).`);
}

/**
 * The backend's "1 g = X kg", asked with the weighbridge's demo login and ADMIN_PIN.
 * Undefined if it cannot be asked (no backend, no ADMIN_PIN): the last value is kept.
 */
async function currentScale(): Promise<number | undefined> {
  const pin = process.env.ADMIN_PIN;
  const kiosk = SEED_USERS.find((user) => user.role === "KIOSK")!;
  if (!pin) return undefined;
  try {
    const login = await fetch(`${httpBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: kiosk.username, pin: kiosk.pin }),
      signal: AbortSignal.timeout(3000),
    });
    if (!login.ok) return undefined;
    const answer = await fetch(`${httpBase}/api/demo/settings`, {
      headers: { cookie: login.headers.getSetCookie()[0]!.split(";")[0]!, "x-admin-pin": pin },
      signal: AbortSignal.timeout(3000),
    });
    if (!answer.ok) return undefined;
    return ((await answer.json()) as DemoSettings).modelScaleKgPerG;
  } catch {
    return undefined;
  }
}

const log = (text: string) => console.log(`${new Date().toLocaleTimeString("en-GB")}  ${text}`);
const now = () => performance.now();

let lastShown = "";
let lastShownAt = 0;

const main = new SimMainBoard({
  url,
  token: token("DEVICE_TOKEN"),
  kgPerGram,
  log,
  onCommand: (command) => {
    if (command.t === "light") {
      log(
        `<- lights: entry ${command.entry}, exit ${command.exit}${command.blink ? ", blinking" : ""}`,
      );
    } else if (command.t === "buzz") log(`<- buzz: ${command.times} x ${command.ms} ms`);
    else if (command.t === "display") {
      log(`<- display: "${(command.lines as string[]).join(" | ")}"`);
    } else if (command.t === "tare") log("<- tare");
    else log(`<- unknown command: ${JSON.stringify(command)}`);
  },
  // Shows the weight when it changes, at most once a second.
  onWeight: (reading) => {
    const shown =
      `${formatKg(reading.kg)} (${(reading.kg / kgPerGram).toFixed(1)} g)  ` +
      `stable=${reading.stable}  position=${reading.pos ? "OK" : main.badSide}`;
    if (shown !== lastShown && now() - lastShownAt >= 1000) {
      log(shown);
      lastShown = shown;
      lastShownAt = now();
    }
  },
});

const cameras = CAMERA_IDS.map(
  (camera) =>
    new SimCamera({
      httpBase,
      camera,
      token: token(camera === "front" ? "CAM_FRONT_TOKEN" : "CAM_BACK_TOKEN"),
      log,
      picture: () =>
        readFile(
          new URL(
            `./sample-plates/${mismatch ? "mismatch" : "match"}-${camera}.jpg`,
            import.meta.url,
          ),
        ),
    }),
);

const HELP = `
  a  LOADED truck arrives (${formatKg(loadedKg)})   e  EMPTY truck arrives (${formatKg(EMPTY_KG)})
  (a loaded truck's second weighing is the same truck coming back empty: press e)
  l  truck leaves                  p  position: OK -> move forward -> move back
  u  toggle unstable wobble        o  all boards offline for 5 s
  m  switch matching / mismatched plate photos
  t  tamper alarm on / off         c  cameras off / on
  h  show these keys               q  quit
`;

function quit(): void {
  main.stop();
  cameras.forEach((camera) => camera.stop());
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  // pause() is not enough: on Windows an open input stream keeps the process running.
  process.stdin.destroy();
  log("simulator stopped");
}

let tamperReason = 0;
let tampered = false;

/** The truck weighs the same in kg whatever "1 g = X kg" is set to on /settings. */
async function arrive(kg: number, what: string): Promise<void> {
  if (args.scale === undefined) {
    const current = await currentScale();
    if (current !== undefined) main.kgPerGram = current;
  }
  main.model.arrive(kg, now());
  log(`${what} arrives: ${formatKg(kg)} (1 g = ${main.kgPerGram} kg)`);
}

const keys: Record<string, () => void> = {
  a: () => void arrive(loadedKg, "key a: a LOADED truck"),
  e: () => void arrive(EMPTY_KG, "key e: an EMPTY truck"),
  l: () => {
    main.model.leave(now());
    log("key l: the truck leaves");
  },
  p: () => {
    const { model } = main;
    if (model.positionOk) {
      main.badSide = "forward";
      model.togglePosition();
    } else if (main.badSide === "forward") main.badSide = "back";
    else model.togglePosition();
    log(`key p: position ${model.positionOk ? "OK" : `NOT OK (${main.badSide})`}`);
  },
  u: () => log(`key u: unstable wobble ${main.model.toggleUnstable(now()) ? "on" : "off"}`),
  o: () => {
    log(`key o: offline for ${OFFLINE_FOR_MS / 1000} s`);
    main.goOffline(OFFLINE_FOR_MS);
    cameras.forEach((camera) => camera.goOffline(OFFLINE_FOR_MS));
  },
  m: () => {
    mismatch = !mismatch;
    log(`key m: cameras now send the ${mismatch ? "mismatched" : "matching"} pair`);
  },
  t: () => {
    tampered = !tampered;
    const reason = TAMPER_REASONS[tamperReason % TAMPER_REASONS.length]!;
    if (!tampered) tamperReason += 1;
    main.setTamper(tampered ? reason : null);
    log(tampered ? `key t: TAMPER "${reason}"` : "key t: tamper cleared");
  },
  c: () => {
    const on = !cameras[0]!.running;
    cameras.forEach((camera) => (on ? camera.start() : camera.stop()));
    log(`key c: cameras ${on ? "on" : "off (offline after 15 s)"}`);
  },
  h: () => console.log(HELP),
  q: quit,
  // Ctrl+C: in raw mode the terminal no longer handles it for us.
  "\u0003": quit,
};

// In a terminal each key acts at once. When input is piped, each character is a key.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data: string) => {
  for (const key of data) keys[key.toLowerCase()]?.();
});

console.log(`Trinetra ESP32 simulator -> ${url}
${HELP}`);
main.kgPerGram = (args.scale === undefined ? await currentScale() : undefined) ?? kgPerGram;
log(`model scale: 1 g = ${main.kgPerGram} kg`);
main.start();
cameras.forEach((camera) => camera.start());
