// Test helper: the default data in the shape the unloading rules function takes.
import {
  SEED_DEFAULT_POINT,
  SEED_UNLOADING_POINTS,
  SEED_UNLOADING_RULES,
  SEED_USERS,
  type SeedPointKey,
} from "../seed/default-data";
import type { Point, TripRule } from "../rules/unloading";

function point(key: SeedPointKey): Point {
  const found = SEED_UNLOADING_POINTS.find((item) => item.key === key)!;
  const user = SEED_USERS.find((item) => item.username === found.supervisor)!;
  return { code: found.code, name: found.name, supervisor: { name: user.name, phone: user.phone } };
}

export const seedRules: TripRule[] = SEED_UNLOADING_RULES.map((rule) => ({
  materialId: rule.material,
  tripFrom: rule.tripFrom,
  tripTo: rule.tripTo,
  point: point(rule.point),
}));

export const seedDefaultPoint = point(SEED_DEFAULT_POINT);
