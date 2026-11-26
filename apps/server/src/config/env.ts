// Every backend setting, checked once at startup. Nothing else should read process.env
// for settings. Error messages name variables but never print their values.
import { z } from "zod";
import { loadEnvFile } from "./paths";

const required = z.string({ error: "is required" });
/** Needed only by a later phase. */
const optional = z.string().optional();
/** A device without a token cannot connect. */
const deviceToken = z.string().min(16, "must be at least 16 characters long").optional();

function isPostgresUrl(value: string): boolean {
  const url = URL.parse(value);
  return !!url && /^postgres(ql)?:$/.test(url.protocol) && url.pathname.length > 1;
}

/** An origin is scheme + host + port only: no path and no trailing slash. */
function isOrigin(value: string): boolean {
  const url = URL.parse(value);
  return !!url && /^https?:$/.test(url.protocol) && url.origin === value;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"], {
        error: "must be development, test or production",
      })
      .default("development"),
    PORT: z.coerce
      .number({ error: "must be a number" })
      .int("must be a whole number")
      .min(1, "must be between 1 and 65535")
      .max(65535, "must be between 1 and 65535")
      .default(4000),
    TZ: z
      .string()
      .refine(isTimeZone, "must be a time zone name such as Asia/Kolkata")
      .default("Asia/Kolkata"),

    DATABASE_URL: required.refine(
      isPostgresUrl,
      "must look like postgres://user:password@host:port/database",
    ),
    JWT_SECRET: required.min(32, "must be at least 32 characters long"),
    FRONTEND_ORIGIN: required.refine(
      isOrigin,
      "must be a website address with no path or trailing slash, e.g. http://localhost:3000",
    ),
    STORAGE_DRIVER: z.enum(["local", "supabase"], {
      error: 'is required and must be "local" or "supabase"',
    }),

    // Required only when STORAGE_DRIVER=supabase (checked below).
    SUPABASE_URL: z.url("must be a web address").optional(),
    SUPABASE_SERVICE_KEY: optional,
    STORAGE_BUCKET: optional,

    TEST_DATABASE_URL: optional,
    PLATE_RECOGNIZER_TOKEN: optional,
    GEMINI_API_KEY: optional,
    GEMINI_MODEL: z
      .string()
      .regex(/^[a-z0-9.-]+$/, "must be a model name such as gemini-3.8-flash")
      .default("gemini-3.8-flash"),
    DEVICE_TOKEN: deviceToken,
    CAM_FRONT_TOKEN: deviceToken,
    CAM_BACK_TOKEN: deviceToken,
  })
  .superRefine((env, context) => {
    // The token is how the backend knows which device is talking, so each needs its own.
    const seen = new Set<string>();
    for (const name of ["DEVICE_TOKEN", "CAM_FRONT_TOKEN", "CAM_BACK_TOKEN"] as const) {
      const token = env[name];
      if (token && seen.has(token)) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "must be different from the other device tokens",
        });
      }
      if (token) seen.add(token);
    }

    if (env.STORAGE_DRIVER !== "supabase") return;
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "STORAGE_BUCKET"] as const) {
      if (!env[name]) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "is required when STORAGE_DRIVER=supabase",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

/** Checks a set of variables. Empty values count as missing. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(present);
  if (result.success) return result.data;

  const problems = result.error.issues.map(
    (issue) => `  - ${issue.path.join(".")} ${issue.message}`,
  );
  throw new EnvError(
    [
      "The server cannot start because of these settings:",
      ...problems,
      "Fix them in apps/server/.env (see apps/server/.env.example).",
    ].join("\n"),
  );
}

/** Reads apps/server/.env, checks it, and applies the time zone to this process. */
export function loadConfig(): Env {
  loadEnvFile();
  const env = parseEnv(process.env);
  process.env.TZ = env.TZ;
  return env;
}
