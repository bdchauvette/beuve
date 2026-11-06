/** A glob and the text it is tried against. */
export interface GlobTest {
  readonly pattern: string;
  readonly value: string;
}

/**
 * Whether `value` matches the glob `pattern` in full (ADR 0111): `*` is any run of characters
 * but `/`, `**` is any run including `/`, `?` is one character but `/`, and everything else is
 * literal, case included. Two stars followed by a slash may match no directory at all, so a
 * pattern of `a`, a slash, two stars, a slash and `b` matches `a/b` as well as `a/x/y/b`. Pure,
 * and no pattern can make it backtrack badly: runs of stars are collapsed.
 */
export function isGlobMatch({ pattern, value }: GlobTest): boolean {
  // The pattern is escaped except for the wildcards, which become fixed regular-expression pieces.
  // eslint-disable-next-line security/detect-non-literal-regexp -- see above
  return new RegExp(`^${regexSourceFrom(pattern)}$`, 'u').test(value);
}

function regexSourceFrom(pattern: string): string {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index] ?? '';
    if (character === '*') {
      let end = index;
      while (pattern[end] === '*') {
        end += 1;
      }
      if (end - index >= 2) {
        if (pattern[end] === '/') {
          source += '(?:.*/)?';
          index = end + 1;
        } else {
          source += '.*';
          index = end;
        }
      } else {
        source += '[^/]*';
        index = end;
      }
    } else if (character === '?') {
      source += '[^/]';
      index += 1;
    } else {
      source += RegExp.escape(character);
      index += 1;
    }
  }
  return source;
}
