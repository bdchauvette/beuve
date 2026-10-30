/**
 * Groups `items` under every key `keysOf` names for them, in input order. A group whose members
 * are the same objects in the same order as in `previous` keeps `previous`'s array, so a Lit
 * property bound to one group changes only when that group does (ADR 0050). An item listed
 * under the same key twice is kept once.
 */
export function groupStable<T>(
  items: readonly T[],
  keysOf: (item: T) => readonly string[],
  previous: ReadonlyMap<string, readonly T[]> = new Map(),
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const keys = new Set(keysOf(item));
    for (const key of keys) {
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [item]);
      } else {
        group.push(item);
      }
    }
  }
  const stable = new Map<string, readonly T[]>();
  for (const [key, group] of groups) {
    const before = previous.get(key);
    stable.set(key, before !== undefined && isSameMembers(before, group) ? before : group);
  }
  return stable;
}

function isSameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
