// Checks a running backend with pretend boards that speak exactly the new firmware
// protocol, so it can be tested without the real ones.
//   pnpm fake-hardware                      against http://localhost:4000
//   pnpm fake-hardware --url http://192.168.43.100:4000
// It needs the kiosk login (from the seed) and ADMIN_PIN, DEVICE_TOKEN and the two camera
// tokens from apps/server/.env. It creates no ticket and changes no setting. Switch the
// real boards and "pnpm sim" off first: a second main board replaces the first.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatKg, type DemoSettings, type KioskStateResponse } from "@trinetra/shared";
import { SEED_USERS } from "@trinetra/shared/seed";
import { WebSocket } from "ws";
import { SimCamera, SimMainBoard } from "./sim/board";

const envFile = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { url: { type: "string" } },
});
const BASE = args.url ?? "http://localhost:4000";
const DEVICE_URL = `${BASE.replace(/^http/, "ws")}/device`;

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in apps/server/.env (see .env.example).`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function report(ok: boolean, what: string, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
}

let cookie = "";
async function logIn(): Promise<void> {
  const kiosk = SEED_USERS.find((user) => user.username === "wb01")!;
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: kiosk.username, pin: kiosk.pin }),
  });
  if (!response.ok) throw new Error('Could not log in as the kiosk. Has "pnpm db:seed" been run?');
  cookie = response.headers.getSetCookie()[0]!.split(";")[0]!;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie, "x-admin-pin": process.env.ADMIN_PIN ?? "" },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

const state = () => get<KioskStateResponse>("/api/kiosk/state");

/** Waits until the backend's state passes the test, and reports it. */
async function expectState(
  what: string,
  done: (value: KioskStateResponse) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await state();
    if (done(value)) return report(true, what);
    if (Date.now() > deadline) return report(false, what, JSON.stringify(value));
    await sleep(200);
  }
}

/** The close code the backend gives a connection with this token. */
function closedWith(token: string): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(DEVICE_URL, { headers: { "x-device-token": token } });
    const timer = setTimeout(() => {
      socket.close();
      resolve(0);
    }, 4000);
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.on("error", () => {});
  });
}

async function run(): Promise<void> {
  console.log(`Fake hardware -> ${BASE}\n`);
  await logIn();
  const { modelScaleKgPerG: scale } = await get<DemoSettings>("/api/demo/settings");
  console.log(`  Model scale: 1 g = ${scale} kg\n`);

  console.log("Who may connect");
  report((await closedWith("not-a-real-device-token")) === 1008, "a wrong token is refused");
  report(
    (await closedWith(setting("CAM_FRONT_TOKEN"))) === 1008,
    "a camera may not use the weighbridge connection",
  );

  console.log("\nMain ESP32");
  const commands: Record<string, unknown>[] = [];
  const main = new SimMainBoard({
    url: DEVICE_URL,
    token: setting("DEVICE_TOKEN"),
    kgPerGram: scale,
    onCommand: (command) => commands.push(command),
  });
  main.start();
  await expectState("it is online, with an empty bridge", (s) => {
    return s.devices.main.online && s.weight?.kg === 0 && s.fault === null;
  });

  // 200 g, the model cargo.
  const cargoKg = Math.round(200 * scale);
  main.model.positionOk = false;
  main.badSide = "forward";
  main.model.arrive(cargoKg, performance.now() - 60_000);
  await expectState(`200 g arrives as ${formatKg(cargoKg)}`, (s) => s.weight?.kg === cargoKg);
  await expectState(
    '"move forward" blocks the weighing',
    (s) => s.canCapture.reason === "POSITION_NOT_OK",
  );
  main.badSide = "back";
  await sleep(600);
  await expectState(
    '"move back" blocks the weighing',
    (s) => s.canCapture.reason === "POSITION_NOT_OK",
  );
  main.model.positionOk = true;
  await expectState("on the bridge and still, the weight may be taken", (s) => s.canCapture.ok);

  const lights = commands.filter((command) => command.t === "light");
  const display = commands.filter((command) => command.t === "display");
  report(
    lights.length > 0 &&
      lights.every((c) => ["R", "Y", "G", "off"].includes(String(c.entry)) && "exit" in c),
    "light commands name both lights",
    JSON.stringify(lights),
  );
  report(
    display.length > 0 &&
      display.every((c) => {
        const lines = c.lines as string[];
        return lines.length >= 1 && lines.length <= 3 && lines.every((l) => l.length <= 21);
      }),
    "display commands fit the OLED",
    JSON.stringify(display),
  );
  report(
    commands.some((command) => command.t === "buzz"),
    "the buzzer was told to sound for the bad position",
  );

  console.log("\nTampering");
  main.setTamper("CELL WIRE OPEN");
  await expectState("a tamper alarm blocks the weighing", (s) => {
    return s.canCapture.reason === "WEIGHBRIDGE_FAULT" && s.fault?.reason === "CELL WIRE OPEN";
  });
  await sleep(4000);
  await expectState(
    "it stays online while it repeats the alarm",
    (s) => s.devices.main.online && s.fault !== null,
    500,
  );
  main.setTamper(null);
  await expectState("cleared: the weight may be taken again", (s) => {
    return s.fault === null && s.canCapture.ok;
  });

  console.log("\nCameras");
  const cameras = (["front", "back"] as const).map(
    (camera) =>
      new SimCamera({
        httpBase: BASE,
        camera,
        token: setting(camera === "front" ? "CAM_FRONT_TOKEN" : "CAM_BACK_TOKEN"),
        picture: () => readFile(new URL(`./sample-plates/match-${camera}.jpg`, import.meta.url)),
        log: (text) => console.log(`        ${text}`),
      }),
  );
  const statuses = await Promise.all(cameras.map((camera) => camera.send()));
  report(
    statuses.every((status) => status === 204),
    "both cameras' frames are taken",
    statuses.join(", "),
  );
  const swapped = new SimCamera({
    httpBase: BASE,
    camera: "front",
    token: setting("CAM_BACK_TOKEN"),
    picture: () => readFile(new URL("./sample-plates/match-back.jpg", import.meta.url)),
  });
  report((await swapped.send()) === 403, "the back token cannot send as the front camera");
  await expectState("both cameras are online", (s) => {
    return s.devices.front.online && s.devices.back.online && !!s.devices.back.lastSeenAt;
  });

  console.log("\nGoing offline");
  main.stop();
  await expectState("without the main ESP32 nothing can be weighed", (s) => {
    return !s.devices.main.online && s.canCapture.reason === "DEVICE_OFFLINE";
  });
  console.log("  (waiting 16 s for the cameras to count as offline)");
  await sleep(16_000);
  await expectState("silent cameras are offline, with a last-seen time", (s) => {
    return !s.devices.front.online && !!s.devices.front.lastSeenAt;
  });

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run()
  .catch((error: Error) => {
    console.error(`\n${error.message}\nIs the backend running ("pnpm dev")?`);
    process.exitCode = 1;
  })
  // The pretend boards keep timers running: leave once the report is out.
  .finally(() => setTimeout(() => process.exit(), 200));
