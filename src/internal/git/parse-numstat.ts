/** One file from `git diff --numstat`, with line counts unless git considers it binary. */
export interface ChangedFile {
  readonly path: string;
  /** The source path when git detected a rename. */
  readonly previousPath: string | undefined;
  readonly stats:
    | { readonly kind: 'text'; readonly added: number; readonly removed: number }
    | { readonly kind: 'binary' };
}

const numstatPattern = /^(-|\d+)\t(-|\d+)\t(.*)$/su;

/**
 * Parses `git diff --numstat -z`: `added\tremoved\tpath\0`, or for renames
 * `added\tremoved\t\0old\0new\0`; binary files count as `-\t-`. `undefined` on malformed input.
 */
export function parseNumstat(text: string): readonly ChangedFile[] | undefined {
  const fields = text.split('\0');
  const files: ChangedFile[] = [];
  let index = 0;
  while (index < fields.length) {
    const field = fields[index] ?? '';
    if (field === '' && index === fields.length - 1) {
      break;
    }
    const match = numstatPattern.exec(field);
    if (match === null) {
      return undefined;
    }
    const [, added = '', removed = '', inlinePath = ''] = match;
    const stats: ChangedFile['stats'] =
      added === '-' || removed === '-'
        ? { kind: 'binary' }
        : { kind: 'text', added: Number(added), removed: Number(removed) };
    if (inlinePath !== '') {
      files.push({ path: inlinePath, previousPath: undefined, stats });
      index += 1;
      continue;
    }
    const previousPath = fields[index + 1];
    const path = fields[index + 2];
    if (previousPath === undefined || path === undefined || previousPath === '' || path === '') {
      return undefined;
    }
    files.push({ path, previousPath, stats });
    index += 3;
  }
  return files;
}
