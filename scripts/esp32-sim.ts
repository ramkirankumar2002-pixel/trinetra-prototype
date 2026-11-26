// A pretend weighbridge: the main ESP32 and both ESP32-CAMs.
//   pnpm sim                 cameras upload the matching plate pair
//   pnpm sim --mismatch      the back camera shows another plate
//   pnpm sim --url ws://host:4000/device
// The device tokens come from apps/server/.env. Start the backend first.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CAMERA_IDS, formatKg, type CameraId } from "@trinetra/shared";
import { SimDevice } from "./sim/device";
import { EMPTY_KG, LOADED_KG, WeightModel } from "./sim/weight-model";

const SEND_EVERY_MS = 200;
const OFFLINE_FOR_MS = 5000;

const envFile = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { url: { type: "string" }, mismatch: { type: "boolean", default: false } },
});
const url = args.url ?? process.env.SIM_SERVER_URL ?? "ws://localhost:4000/device";
const httpBase = url.replace(/^ws/, "http").replace(/\/device$/, "");
let mismatch = args.mismatch;

function token(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in apps/server/.env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const log = (text: string) => console.log(`${new Date().toLocaleTimeString("en-GB")}  ${text}`);
const model = new WeightModel();
const now = () => performance.now();

const main = new SimDevice({
  name: "main ESP32",
  url,
  token: token("DEVICE_TOKEN"),
  log,
  onCommand: (command) => {
    if (command.t === "light") log(`<- light: ${command.c}`);
    else if (command.t === "buzz") log(`<- buzz: ${command.ms} ms`);
    else if (command.t === "display") log(`<- display: "${command.text}"`);
    else if (command.t === "tare") log("<- tare");
    else log(`<- unknown command: ${JSON.stringify(command)}`);
  },
});

async function uploadPhoto(camera: CameraId, id: string, cameraToken: string): Promise<void> {
  const file = `${mismatch ? "mismatch" : "match"}-${camera}.jpg`;
  try {
    const body = await readFile(new URL(`./sample-plates/${file}`, import.meta.url));
    const response = await fetch(`${httpBase}/api/device/photo/${id}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg", "x-device-token": cameraToken },
      body: new Uint8Array(body),
    });
    const answer = response.ok ? "uploaded" : `refused: ${await response.text()}`;
    log(`${camera} camera: ${file} ${answer}`);
  } catch (error) {
    log(`${camera} camera: upload failed: ${(error as Error).message}`);
  }
}

const cameras = CAMERA_IDS.map((camera) => {
  const cameraToken = token(camera === "front" ? "CAM_FRONT_TOKEN" : "CAM_BACK_TOKEN");
  const device: SimDevice = new SimDevice({
    name: `${camera} camera`,
    url,
    token: cameraToken,
    log,
    onOpen: () => device.send({ t: "hello", cam: camera }),
    onCommand: (command) => {
      if (command.t !== "snap" || typeof command.id !== "string") return;
      log(`<- snap (${camera} camera)`);
      void uploadPhoto(camera, command.id, cameraToken);
    },
  });
  return device;
});
const devices = [main, ...cameras];

let lastShown = "";
let lastShownAt = 0;
const sender = setInterval(() => {
  const reading = model.read(now());
  main.send({ t: "w", ...reading });

  // Shows the weight when it changes, at most once a second.
  const shown = `${formatKg(reading.kg)}  stable=${reading.stable}  position=${reading.pos ? "OK" : "NOT OK"}`;
  if (shown !== lastShown && now() - lastShownAt >= 1000) {
    log(shown);
    lastShown = shown;
    lastShownAt = now();
  }
}, SEND_EVERY_MS);

const HELP = `
  a  truck arrives (${formatKg(LOADED_KG)})     e  empty truck (${formatKg(EMPTY_KG)})
  l  truck leaves                  p  toggle position OK
  u  toggle unstable wobble        o  all boards offline for 5 s
  m  switch matching / mismatched plate photos
  h  show these keys               q  quit
`;

function quit(): void {
  clearInterval(sender);
  devices.forEach((device) => device.close());
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  log("simulator stopped");
}

const keys: Record<string, () => void> = {
  a: () => {
    model.arrive(LOADED_KG, now());
    log("key a: a loaded truck arrives");
  },
  e: () => {
    model.arrive(EMPTY_KG, now());
    log("key e: an empty truck arrives");
  },
  l: () => {
    model.leave(now());
    log("key l: the truck leaves");
  },
  p: () => log(`key p: position ${model.togglePosition() ? "OK" : "NOT OK"}`),
  u: () => log(`key u: unstable wobble ${model.toggleUnstable(now()) ? "on" : "off"}`),
  o: () => {
    log(`key o: offline for ${OFFLINE_FOR_MS / 1000} s`);
    devices.forEach((device) => device.goOffline(OFFLINE_FOR_MS));
  },
  m: () => {
    mismatch = !mismatch;
    log(`key m: cameras now send the ${mismatch ? "mismatched" : "matching"} pair`);
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

console.log(`Trinetra ESP32 simulator -> ${url}\n${HELP}`);
devices.forEach((device) => device.connect());
