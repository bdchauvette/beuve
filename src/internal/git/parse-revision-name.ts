import type { Brand } from '#x/brand/brand.ts';
import { hasControlCharacters } from '#x/text/has-control-characters.ts';

/**
 * A revision expression that `git cat-file --batch-command` can resolve on its line protocol
 * without risk: a ref name, `HEAD`, a (possibly abbreviated) object name, optionally followed by
 * `~n` and `^n` steps. Nothing that names a path (`:`), a reflog entry (`@{…}`, which can make
 * cat-file exit fatally), a peel or search (`^{…}`, added by the reader itself), a range (`..`)
 * or a glob; no whitespace or control characters; and no leading `-`.
 */
export type RevisionName = Brand<string, 'RevisionName'>;

const maxRevisionLength = 1024;
const firstCharacter = /^[\w]/u;
const refused = /[\s:?*[\\{}]|\.\.|@\{/u;

/**
 * `text` as a {@link RevisionName}, or `undefined` when it is not one. A valid revision this
 * refuses (`main@{1}`, a branch whose name holds `{`) is resolved by a one-off `rev-parse`
 * instead.
 */
export function parseRevisionName(text: string): RevisionName | undefined {
  if (
    text.length === 0 ||
    text.length > maxRevisionLength ||
    !firstCharacter.test(text) ||
    refused.test(text) ||
    hasControlCharacters(text)
  ) {
    return undefined;
  }
  return text as RevisionName;
}
