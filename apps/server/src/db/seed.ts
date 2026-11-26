import {
  SEED_CHAINAGES,
  SEED_DEFAULT_POINT,
  SEED_MATERIALS,
  SEED_SETTINGS,
  SEED_SUPPLIERS,
  SEED_TRANSPORTERS,
  SEED_UNLOADING_POINTS,
  SEED_UNLOADING_RULES,
  SEED_USERS,
  SEED_VEHICLES,
} from "@trinetra/shared/seed";
import bcrypt from "bcrypt";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import * as schema from "./schema";

const BCRYPT_ROUNDS = 10;

/** Looks up an id by name, and fails clearly if default-data.ts has a wrong reference. */
function idOf(ids: Map<string, number>, key: string, what: string): number {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`default-data.ts refers to an unknown ${what}: "${key}"`);
  return id;
}

function required<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("The database did not return the saved row.");
  return row;
}

/**
 * Loads default-data.ts into the database. Safe to run again: rows are matched by their
 * names and updated. Rows removed from the file stay until a reset, except unloading rules,
 * which are always replaced.
 *
 * With `reset`, every table is emptied first, including tickets and their timeline.
 * Everything happens in one transaction, so a failure changes nothing.
 */
export async function seedDatabase(db: Database, options: { reset?: boolean } = {}): Promise<void> {
  // Hash before the transaction: bcrypt is slow on purpose.
  const users = await Promise.all(
    SEED_USERS.map(async ({ pin, ...user }) => ({
      ...user,
      pinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS),
    })),
  );

  await db.transaction(async (tx) => {
    if (options.reset) {
      const names = Object.values(schema)
        .filter((value) => is(value, PgTable))
        .map((table) => `"${getTableName(table)}"`)
        .join(", ");
      await tx.execute(sql.raw(`truncate table ${names} restart identity cascade`));
    }

    const userIds = new Map<string, number>();
    for (const user of users) {
      const [row] = await tx
        .insert(schema.users)
        .values(user)
        .onConflictDoUpdate({ target: schema.users.username, set: user })
        .returning({ id: schema.users.id });
      userIds.set(user.username, required(row).id);
    }

    const materialIds = new Map<string, number>();
    for (const material of SEED_MATERIALS) {
      const [row] = await tx
        .insert(schema.materials)
        .values(material)
        .onConflictDoUpdate({ target: schema.materials.name, set: material })
        .returning({ id: schema.materials.id });
      materialIds.set(material.name, required(row).id);
    }

    for (const { supervisor, ...chainage } of SEED_CHAINAGES) {
      const values = { ...chainage, supervisorId: idOf(userIds, supervisor, "supervisor") };
      await tx
        .insert(schema.chainages)
        .values(values)
        .onConflictDoUpdate({ target: schema.chainages.code, set: values });
    }

    const pointIds = new Map<string, number>();
    for (const { key, supervisor, ...point } of SEED_UNLOADING_POINTS) {
      const values = { ...point, supervisorId: idOf(userIds, supervisor, "supervisor") };
      const [row] = await tx
        .insert(schema.unloadingPoints)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.unloadingPoints.code, schema.unloadingPoints.supervisorId],
          set: values,
        })
        .returning({ id: schema.unloadingPoints.id });
      pointIds.set(key, required(row).id);
    }

    // Replaced as a whole: nothing points at a rule, and edited ranges would otherwise overlap.
    await tx.delete(schema.unloadingRules);
    await tx.insert(schema.unloadingRules).values([
      ...SEED_UNLOADING_RULES.map((rule) => ({
        materialId: idOf(materialIds, rule.material, "material"),
        tripFrom: rule.tripFrom,
        tripTo: rule.tripTo,
        pointId: idOf(pointIds, rule.point, "unloading point"),
      })),
      { pointId: idOf(pointIds, SEED_DEFAULT_POINT, "unloading point"), isDefault: true },
    ]);

    const transporterIds = new Map<string, number>();
    for (const name of SEED_TRANSPORTERS) {
      const [row] = await tx
        .insert(schema.transporters)
        .values({ name })
        .onConflictDoUpdate({ target: schema.transporters.name, set: { name } })
        .returning({ id: schema.transporters.id });
      transporterIds.set(name, required(row).id);
    }

    for (const { plate, transporter } of SEED_VEHICLES) {
      const values = { plate, transporterId: idOf(transporterIds, transporter, "transporter") };
      await tx
        .insert(schema.vehicles)
        .values(values)
        .onConflictDoUpdate({ target: schema.vehicles.plate, set: values });
    }

    for (const name of SEED_SUPPLIERS) {
      await tx.insert(schema.suppliers).values({ name }).onConflictDoNothing();
    }

    for (const [key, value] of Object.entries(SEED_SETTINGS)) {
      await tx
        .insert(schema.settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
    }
  });
}
