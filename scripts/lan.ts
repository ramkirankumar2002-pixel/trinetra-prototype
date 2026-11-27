// pnpm lan: the website and the backend, ready for a phone on the same Wi-Fi.
//   pnpm lan
//   pnpm lan --ip 192.168.1.20    if it picks the wrong network
//
// The website runs with https (a phone's camera needs a secure page), with a certificate
// made here and signed by nobody, so the phone warns once. The phone needs only that one
// address: the website forwards /api and the live connection to the backend. Nothing is
// downloaded and nothing is added to Windows' list of trusted certificates.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generate } from "selfsigned";
import { lanAddresses } from "./lan-address";

const WEB_PORT = 3000;
const SERVER_PORT = 4000;
const root = fileURLToPath(new URL("../", import.meta.url));
const certFolder = `${root}apps/web/certificates`;
const keyFile = `${certFolder}/lan-key.pem`;
const certFile = `${certFolder}/lan-cert.pem`;

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { ip: { type: "string" } },
});

function chooseAddress(): string {
  if (args.ip) return args.ip;
  const [best, ...others] = lanAddresses(networkInterfaces());
  if (!best) {
    console.error(
      "No network found. Connect the laptop to the same Wi-Fi as the phone, " +
        "or name the address: pnpm lan --ip 192.168.1.20",
    );
    process.exit(1);
  }
  console.log(`Using ${best.name}: ${best.address}`);
  for (const other of others) {
    console.log(`  (also found ${other.name}: ${other.address} — pnpm lan --ip ${other.address})`);
  }
  return best.address;
}

const portInUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

/** The certificate is kept, so a phone that accepted it is not asked again. */
async function certificateFor(address: string): Promise<void> {
  if (existsSync(keyFile) && existsSync(certFile)) {
    const saved = new X509Certificate(await readFile(certFile));
    const dayLeft = new Date(saved.validTo).getTime() > Date.now() + 24 * 60 * 60 * 1000;
    if (dayLeft && saved.checkIP(address)) return;
  }
  const until = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const pems = await generate([{ name: "commonName", value: address }], {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: until,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 7, ip: address },
          { type: 7, ip: "127.0.0.1" },
          { type: 2, value: "localhost" },
        ],
      },
    ],
  });
  await mkdir(certFolder, { recursive: true });
  await writeFile(keyFile, pems.private);
  await writeFile(certFile, pems.cert);
}

const children: ChildProcess[] = [];
let stopping = false;

function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    // On Windows, ending the shell would leave Node running and the port taken.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else child.kill("SIGTERM");
  }
  process.exit(code);
}

function start(command: string, env: Record<string, string>): void {
  const child = spawn(command, {
    cwd: root,
    shell: true,
    stdio: "inherit",
    // Settings given here win over apps/server/.env and apps/web/.env.local.
    env: { ...process.env, ...env },
  });
  child.on("exit", (code) => stop(code ?? 1));
  children.push(child);
}

async function main(): Promise<void> {
  const address = chooseAddress();
  for (const port of [WEB_PORT, SERVER_PORT]) {
    if (await portInUse(port)) {
      console.error(`Port ${port} is already in use. Stop "pnpm dev" first, then run pnpm lan.`);
      process.exit(1);
    }
  }
  await certificateFor(address);
  const publicUrl = `https://${address}:${WEB_PORT}`;
  const shared = { PUBLIC_WEB_URL: publicUrl };

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  start("pnpm --filter @trinetra/server run dev", {
    ...shared,
    PORT: String(SERVER_PORT),
    // The kiosk on this laptop. The phones' address is allowed through PUBLIC_WEB_URL.
    FRONTEND_ORIGIN: `https://localhost:${WEB_PORT}`,
  });
  start(
    `pnpm --filter @trinetra/web exec next dev --port ${WEB_PORT} --experimental-https ` +
      `--experimental-https-key certificates/lan-key.pem ` +
      `--experimental-https-cert certificates/lan-cert.pem`,
    {
      ...shared,
      BACKEND_URL: `http://localhost:${SERVER_PORT}`,
      NEXT_PUBLIC_SOCKET_URL: "same-origin",
    },
  );

  for (let tries = 0; tries < 240; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await portInUse(WEB_PORT)) && (await portInUse(SERVER_PORT))) break;
  }
  // After the two programs' own first lines, so it is not scrolled away at once.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  banner(publicUrl);
}

function banner(publicUrl: string): void {
  const line = "=".repeat(72);
  console.log(`
${line}

   ON THE PHONE (same Wi-Fi as this laptop), OPEN:

       ${publicUrl}/supervisor

   The phone warns about the certificate the first time.
   Tap "Advanced" → "Proceed" (iPhone: "Show Details" → "visit this website").

   Kiosk on this laptop:   https://localhost:${WEB_PORT}/kiosk
   Simulated weighbridge:  pnpm sim          (in a second terminal)

   Phone cannot connect? Allow Node.js on PRIVATE networks in Windows Firewall.
   Stop: Ctrl+C

${line}
`);
}

await main();
