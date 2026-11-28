// What the demo settings page shows besides its switches: how much of the free reading
// services is used, whether the boards are there, and the seeded rules (to read only).
import {
  DEFAULT_TOLERANCE_PCT,
  DEVICE_IDS,
  type DemoMasterData,
  type DemoOverview,
  type DeviceId,
  type UsageMeter,
} from "@trinetra/shared";
import { SAMPLE_INVOICES } from "@trinetra/shared/seed";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  chainages,
  materials,
  unloadingPoints,
  unloadingRules,
  users,
  vehicles,
} from "../db/schema";
import { OFFLINE_AFTER_MS } from "../hardware/state";
import {
  GEMINI_DAILY_WARNING,
  PLATE_RECOGNIZER_MONTHLY_LIMIT,
  WARN_FRACTION,
} from "../services/readers/usage";
import { readNumberSetting } from "./repo";

export const usageMeter = (used: number, limit: number): UsageMeter => ({
  used,
  limit,
  warn: used >= limit * WARN_FRACTION,
});

export async function demoOverview(app: FastifyInstance, now = new Date()): Promise<DemoOverview> {
  const day = now.toISOString().slice(0, 10);
  const [lookups, requests] = await Promise.all([
    app.readers.usage.count("plate_recognizer", day.slice(0, 7)),
    app.readers.usage.count("gemini", day),
  ]);
  const { state, simulatedWeight, lastHeard } = app.hardware;
  const simulated = simulatedWeight.current() !== undefined;

  const device = (id: DeviceId) => {
    const heard = lastHeard(id);
    // While the weight is simulated, the state counts the pretend readings as the ESP32's.
    const online =
      id === "main" && simulated
        ? heard !== null && now.getTime() - heard.getTime() <= OFFLINE_AFTER_MS.main
        : state.isOnline(id);
    return { online, lastSeenAt: heard?.toISOString() ?? null };
  };

  return {
    usage: {
      plateRecognizer: usageMeter(lookups, PLATE_RECOGNIZER_MONTHLY_LIMIT),
      gemini: usageMeter(requests, GEMINI_DAILY_WARNING),
    },
    devices: Object.fromEntries(
      DEVICE_IDS.map((id) => [id, device(id)]),
    ) as DemoOverview["devices"],
    weightSimulated: simulated,
    fault: state.fault,
  };
}

export async function demoMasterData(app: FastifyInstance): Promise<DemoMasterData> {
  const [materialRows, chainageRows, ruleRows, vehicleRows, tolerancePct] = await Promise.all([
    app.db.select().from(materials).orderBy(asc(materials.id)),
    app.db
      .select({ code: chainages.code, location: chainages.location, supervisor: users.name })
      .from(chainages)
      .innerJoin(users, eq(chainages.supervisorId, users.id))
      .orderBy(asc(chainages.code)),
    app.db
      .select({
        rule: unloadingRules,
        code: unloadingPoints.code,
        name: unloadingPoints.name,
        supervisor: users.name,
      })
      .from(unloadingRules)
      .innerJoin(unloadingPoints, eq(unloadingRules.pointId, unloadingPoints.id))
      .innerJoin(users, eq(unloadingPoints.supervisorId, users.id)),
    app.db.select({ plate: vehicles.plate }).from(vehicles).orderBy(asc(vehicles.plate)),
    readNumberSetting(app.db, "tolerance_pct", DEFAULT_TOLERANCE_PCT),
  ]);
  const nameOf = new Map(materialRows.map((row) => [row.id, row.name]));
  /** In the materials' order, then by trip; the rule for everything else comes last. */
  const order = ({ rule }: (typeof ruleRows)[number]) =>
    (rule.materialId ?? 100_000) * 10_000 + (rule.tripFrom ?? 9999);

  return {
    tolerancePct,
    materials: materialRows.map(({ name, type, type2AboveKg }) => ({ name, type, type2AboveKg })),
    chainages: chainageRows,
    unloadingRules: [...ruleRows]
      .sort((a, b) => order(a) - order(b))
      .map(({ rule, code, name, supervisor }) => ({
        material: rule.materialId === null ? null : (nameOf.get(rule.materialId) ?? null),
        tripFrom: rule.tripFrom,
        tripTo: rule.tripTo,
        point: { code, name },
        supervisor,
        isDefault: rule.isDefault,
      })),
    plates: vehicleRows.map((row) => row.plate),
    invoices: SAMPLE_INVOICES.map((invoice) => ({
      id: invoice.id,
      material: invoice.expected.material,
      plate: invoice.printed.vehicle_number.replaceAll(" ", ""),
      weightKg: invoice.expected.weightKg,
    })),
  };
}
