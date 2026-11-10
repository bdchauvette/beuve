/** A file's patch: the lines before its first hunk, and each hunk, every line with its newline. */
export interface SplitPatch {
  readonly preamble: string;
  readonly hunks: readonly string[];
}

const afterNewline = /(?<=\n)/u;

/**
 * Splits a unified diff of one file at its hunk headers. Hunk content lines always start with
 * ` `, `+`, `-` or `\`, so every line starting `@@ -` is a header. Pure.
 */
export function splitPatchHunks(patch: string): SplitPatch {
  let preamble = '';
  const hunks: string[] = [];
  let current: string | undefined;
  for (const line of patch.split(afterNewline)) {
    if (line.startsWith('@@ -')) {
      if (current !== undefined) {
        hunks.push(current);
      }
      current = line;
    } else if (current === undefined) {
      preamble += line;
    } else {
      current += line;
    }
  }
  if (current !== undefined) {
    hunks.push(current);
  }
  return { preamble, hunks };
}
