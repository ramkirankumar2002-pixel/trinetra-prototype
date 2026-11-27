import { isLocalOnlyUrl } from "@trinetra/shared";
import { buildApp } from "./app";
import { EnvError, loadConfig, publicWebUrl, type Env } from "./config/env";

let env: Env;
try {
  env = loadConfig();
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const app = await buildApp({ env, logger: true });
if (isLocalOnlyUrl(publicWebUrl(env))) {
  app.log.warn(
    'The QR codes hold a localhost address, which a phone cannot open. Run "pnpm lan" to use a phone.',
  );
}

// Hosts stop the server with SIGTERM: finish open requests first.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
