import { buildApp } from "./app";
import { EnvError, loadConfig, type Env } from "./config/env";

let env: Env;
try {
  env = loadConfig();
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const app = buildApp({ logger: true });

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
