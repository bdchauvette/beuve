import type { FunctionMeasurement } from './function-measurement.ts';

/** How a base function corresponds to a head function. */
export type FunctionPair =
  | { readonly kind: 'added'; readonly head: FunctionMeasurement }
  | { readonly kind: 'removed'; readonly base: FunctionMeasurement }
  | {
      readonly kind: 'matched' | 'renamed';
      readonly base: FunctionMeasurement;
      readonly head: FunctionMeasurement;
    };

/** Bodies shorter than this (`{}`, `{ return x; }`) are too common to identify a rename. */
const minRenameBodyLength = 32;

/**
 * Pairs a file's base and head functions (ADR 0015): first by qualified name, then leftovers with
 * an identical body under another name as renames; the rest are added or removed. Linear in the
 * number of functions. Head pairs come in head order, removed functions last in base order.
 */
export function matchFunctions(
  base: readonly FunctionMeasurement[],
  head: readonly FunctionMeasurement[],
): readonly FunctionPair[] {
  const baseByName = new Map(
    base.map((measurement) => {
      return [measurement.name, measurement];
    }),
  );
  const matchedNames = new Set(
    head.map((measurement) => measurement.name).filter((name) => baseByName.has(name)),
  );
  const unmatchedBodies = new Map<string, FunctionMeasurement[]>();
  for (const measurement of base) {
    if (matchedNames.has(measurement.name) || measurement.bodyLength < minRenameBodyLength) {
      continue;
    }
    unmatchedBodies
      .getOrInsertComputed(measurement.bodyHash, () => {
        return [];
      })
      .push(measurement);
  }
  const renamedFrom = new Set<FunctionMeasurement>();
  const pairs: FunctionPair[] = head.map((measurement): FunctionPair => {
    const sameName = matchedNames.has(measurement.name)
      ? baseByName.get(measurement.name)
      : undefined;
    if (sameName !== undefined) {
      return { kind: 'matched', base: sameName, head: measurement };
    }
    const renamed =
      measurement.bodyLength >= minRenameBodyLength
        ? unmatchedBodies.get(measurement.bodyHash)?.shift()
        : undefined;
    if (renamed === undefined) {
      return { kind: 'added', head: measurement };
    }
    renamedFrom.add(renamed);
    return { kind: 'renamed', base: renamed, head: measurement };
  });
  for (const measurement of base) {
    if (!matchedNames.has(measurement.name) && !renamedFrom.has(measurement)) {
      pairs.push({ kind: 'removed', base: measurement });
    }
  }
  return pairs;
}
