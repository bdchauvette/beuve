/** One entry of `git ls-tree -z` in its default format. */
export interface LsTreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly objectId: string;
  /** Repository-relative with `/` separators, exactly as stored: never quoted under `-z`. */
  readonly path: string;
}

const entryPattern = /^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t(.+)$/su;

/**
 * Parses one NUL-terminated `ls-tree -z` entry, `<mode> SP <type> SP <oid> TAB <path>`, or
 * `undefined` for anything else. The default format is used on purpose: on git 2.43,
 * `--format=…%(path)` still C-quotes a path holding `"`, `\` or a control character even with
 * `-z`, while the default format never quotes under `-z`.
 */
export function parseLsTreeEntry(entry: string): LsTreeEntry | undefined {
  const match = entryPattern.exec(entry);
  if (match === null) {
    return undefined;
  }
  const [, mode, type, objectId, path] = match;
  if (mode === undefined || type === undefined || objectId === undefined || path === undefined) {
    return undefined;
  }
  return { mode, type, objectId, path };
}
