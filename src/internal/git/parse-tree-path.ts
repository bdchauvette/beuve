import type { Brand } from '#x/brand/brand.ts';
import { hasControlCharacters } from '#x/text/has-control-characters.ts';

/**
 * A repository-relative path that `git cat-file --batch-command` can take on its line protocol
 * as `<commit>:<path>`: `/`-separated, no empty, `.` or `..` segment, no leading or trailing
 * whitespace, and no control character (NUL, newline, a CR that git's line reader would strip,
 * tab, DEL). Paths git can store but this refuses still exist; callers read them another way.
 */
export type TreePath = Brand<string, 'TreePath'>;

const maxTreePathLength = 4096;

/**
 * `text` as a {@link TreePath}, or `undefined` when it is not one. `<rev>:../x` makes cat-file
 * exit fatally (failing every request queued behind it), `<rev>:./x` is resolved against the
 * working directory, and a newline would end the request early, so all of those are refused.
 */
export function parseTreePath(text: string): TreePath | undefined {
  if (
    text.length === 0 ||
    text.length > maxTreePathLength ||
    text.trim() !== text ||
    hasControlCharacters(text)
  ) {
    return undefined;
  }
  const segments = text.split('/');
  if (
    segments.every((segment) => {
      return !['', '.', '..'].includes(segment);
    })
  ) {
    return text as TreePath;
  }
  return undefined;
}
