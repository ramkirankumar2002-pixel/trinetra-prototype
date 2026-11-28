// Counts the real API calls, per day, in the settings table, and warns near the free limits.
// "pnpm db:seed --reset" clears the counts; the services' own dashboards stay the truth.
import { like, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../../db/client";
import { settings } from "../../db/schema";
import type { ApiService } from "./errors";

/** Plate Recognizer's free plan (their pricing page, November 2026). */
export const PLATE_RECOGNIZER_MONTHLY_LIMIT = 2500;
/** Google does not publish one fixed free limit: this is only an early warning. */
export const GEMINI_DAILY_WARNING = 200;
export const WARN_FRACTION = 0.8;

export interface UsageCounter {
  /** Call once for every request sent to the service. Never throws. */
  record(service: ApiService): Promise<void>;
}

const keyPrefix = (service: ApiService) => `api_usage:${service}:`;

export function createUsageCounter(
  db: Database,
  log: Pick<FastifyBaseLogger, "warn">,
  now: () => Date = () => new Date(),
) {
  /** The calls counted on days whose key starts like `prefix`. */
  async function total(prefix: string): Promise<number> {
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(like(settings.key, `${prefix.replaceAll("_", "\\_")}%`));
    return rows.reduce((sum, row) => sum + Number(row.value), 0);
  }

  return {
    async record(service: ApiService): Promise<void> {
      try {
        const day = now().toISOString().slice(0, 10);
        const [row] = await db
          .insert(settings)
          .values({ key: `${keyPrefix(service)}${day}`, value: 1 })
          .onConflictDoUpdate({
            target: settings.key,
            // Added inside the database, so two calls at once are both counted.
            set: { value: sql`to_jsonb((${settings.value} #>> '{}')::int + 1)` },
          })
          .returning({ value: settings.value });

        if (service === "plate_recognizer") {
          const month = await total(`${keyPrefix(service)}${day.slice(0, 7)}`);
          if (month >= PLATE_RECOGNIZER_MONTHLY_LIMIT * WARN_FRACTION) {
            log.warn(
              { calls: month, limit: PLATE_RECOGNIZER_MONTHLY_LIMIT },
              "Plate Recognizer: close to this month's free limit",
            );
          }
        } else if (Number(row!.value) >= GEMINI_DAILY_WARNING * WARN_FRACTION) {
          log.warn(
            { callsToday: row!.value },
            "Gemini: many calls today, check the free quota in Google AI Studio",
          );
        }
      } catch (error) {
        // Counting must never stop a truck.
        log.warn({ err: error, service }, "could not count an API call");
      }
    },
    /** Calls on the days starting with `period`: "2026-11-26" or "2026-11". */
    count: (service: ApiService, period: string) => total(`${keyPrefix(service)}${period}`),
  };
}
