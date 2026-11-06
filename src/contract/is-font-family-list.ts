const maxLength = 200;
const control = /\p{Cc}/u;
const quoted = /^(?:"[^"\\]+"|'[^'\\]+')$/u;
const identifier = /^-?[\p{L}_][\p{L}\p{N}_-]*$/u;
const spaces = /\s+/u;
const cssWideKeywords: ReadonlySet<string> = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'default',
]);

/**
 * Whether `value` is a font family preference (ADR 0122): empty for the default, or a CSS
 * `font-family` list such as `"JetBrains Mono", Menlo, monospace`, at most 200 characters. Each
 * family is a quoted name or a run of identifiers, so no value can hold a `var()`, a `url()`,
 * a declaration break, an escape or a control character. Shared by main's validation and the Settings window.
 */
export function isFontFamilyList(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return true;
  }
  if (trimmed.length > maxLength || control.test(trimmed)) {
    return false;
  }
  return trimmed.split(',').every((family) => isFamily(family.trim()));
}

function isFamily(family: string): boolean {
  if (quoted.test(family)) {
    return true;
  }
  const words = family.split(spaces);
  return words.every((word) => {
    return identifier.test(word) && !cssWideKeywords.has(word.toLowerCase());
  });
}
