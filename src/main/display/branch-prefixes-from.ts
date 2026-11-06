const maxPrefixes = 8;
const prefixCharacters = /^[\w./-]{1,100}$/u;

/**
 * The stored branch prefixes of the review queue (ADR 0113): trimmed, de-duplicated and limited
 * to safe ref characters (no leading `/` or `-`, no `..`), at most 8. A value that is not a list
 * of strings reads as the default; an empty list turns agent branches off. Pure.
 */
export function branchPrefixesFrom(stored: unknown): readonly string[] {
  if (!Array.isArray(stored)) {
    return ['claude/'];
  }
  const entries: readonly unknown[] = stored;
  if (entries.some((entry) => typeof entry !== 'string')) {
    return ['claude/'];
  }
  const prefixes = (entries as readonly string[])
    .map((entry) => entry.trim())
    .filter((entry) => isSafePrefix(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index);
  return prefixes.slice(0, maxPrefixes);
}

/** A ref path prefix that is safe in an API path: no leading `/` or `-`, no `..` or `//`. */
function isSafePrefix(prefix: string): boolean {
  return (
    prefixCharacters.test(prefix) &&
    !prefix.startsWith('/') &&
    !prefix.startsWith('-') &&
    !prefix.includes('..') &&
    !prefix.includes('//')
  );
}
