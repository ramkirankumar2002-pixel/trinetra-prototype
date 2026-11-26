// Unloading point (build plan section 6, rule 8).

export interface Supervisor {
  name: string;
  phone: string | null;
}

export interface Point {
  code: string;
  name: string;
  supervisor: Supervisor;
}

export interface TripRule<P extends Point = Point> {
  materialId: number | string;
  /** Trip numbers counted per material, both ends included. */
  tripFrom: number;
  tripTo: number;
  point: P;
}

export interface UnloadingChoice<P extends Point = Point> {
  point: P;
  supervisor: P["supervisor"];
  /** True when no rule matched and the default point was used. */
  isDefault: boolean;
}

/**
 * The point of the rule whose trip range contains `tripNo` for this material, otherwise
 * `defaultPoint` (the material's own default if it has one, else the overall default).
 * The database stops ranges overlapping, so at most one rule can match.
 */
export function resolveUnloadingPoint<P extends Point>(
  materialId: number | string,
  tripNo: number,
  rules: readonly TripRule<P>[],
  defaultPoint: P,
): UnloadingChoice<P> {
  if (!Number.isSafeInteger(tripNo) || tripNo < 1) {
    throw new RangeError(`A trip number is a whole number from 1, not ${tripNo}.`);
  }
  const rule = rules.find(
    (candidate) =>
      candidate.materialId === materialId &&
      tripNo >= candidate.tripFrom &&
      tripNo <= candidate.tripTo,
  );
  const point = rule?.point ?? defaultPoint;
  return { point, supervisor: point.supervisor, isDefault: !rule };
}
