// The app's preview button (.claude/launch.json) runs this. It sets PORT=3000 for what it
// starts, and the backend reads PORT too, so both programs would take port 3000. Without
// that variable this is exactly `pnpm dev`: the website on 3000 (fixed in its own script)
// and the backend on PORT from apps/server/.env, or 4000.
import { spawn } from "node:child_process";
import process from "node:process";

const env = { ...process.env };
delete env.PORT;

// A shell, because on Windows pnpm is a .cmd file.
const child = spawn("pnpm dev", { stdio: "inherit", shell: true, env });
child.on("exit", (code) => process.exit(code ?? 1));
