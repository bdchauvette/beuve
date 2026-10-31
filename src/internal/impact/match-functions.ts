import type { FunctionMeasurement } from './function-measurement.ts';

/** The functions measured on each side of a file. */
export interface FunctionSides {
  readonly base: readonly FunctionMeasurement[];
  readonly head: readonly FunctionMeasurement[];
}

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
export function matchFunctions({ base, head }: FunctionSides): readonly FunctionPair[] {
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
  const renameSource = (measurement: FunctionMeasurement): FunctionMeasurement | undefined => {
    if (measurement.bodyLength < minRenameBodyLength) {
      return undefined;
    }
    return unmatchedBodies.get(measurement.bodyHash)?.shift();
  };
  const pairs: FunctionPair[] = head.map((measurement): FunctionPair => {
    const sameName = baseByName.get(measurement.name);
    if (sameName !== undefined && matchedNames.has(measurement.name)) {
      return { kind: 'matched', base: sameName, head: measurement };
    }
    const renamed = renameSource(measurement);
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
