/**
 * The canonical form of the path prefixes a review was limited to (ADR 0024): each prefix has no
 * empty, `.` or trailing segments; prefixes are sorted and de-duplicated; a prefix already covered
 * by a shorter one (`src/auth.ts` under `src`) is dropped, since it selects no extra file. Prefixes
 * that are empty or contain `..` select nothing sensible and are dropped. `[]` means the whole
 * change.
 */
export function normalizePathScope(prefixes: readonly string[]): readonly string[] {
  const cleaned = new Set<string>();
  for (const prefix of prefixes) {
    const segments = prefix.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.length > 0 && !segments.includes('..')) {
      cleaned.add(segments.join('/'));
    }
  }
  const sorted = [...cleaned].toSorted(compareCodeUnits);
  return sorted.filter((prefix) =>
    sorted.every((other) => other === prefix || !prefix.startsWith(`${other}/`)),
  );
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
