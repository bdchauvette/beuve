/**
 * The head-side line (1-based) of a patch's first change: the first added line, or for a deletion
 * the head line just before the gap. `undefined` when the patch changes nothing on the head side
 * (a deleted file, or no hunks).
 */
export function findFirstChangedLine(patch: string): number | undefined {
  let nextLine: number | undefined;
  let hunkStart = 1;
  for (const text of patch.split('\n')) {
    const header = parseHunkHeader(text);
    if (header !== undefined) {
      hunkStart = header.start;
      nextLine = header.count === 0 ? hunkStart + 1 : hunkStart;
      continue;
    }
    if (nextLine === undefined) {
      continue;
    }
    if (text.startsWith('+')) {
      return nextLine;
    }
    if (text.startsWith('-')) {
      return hunkStart === 0 ? undefined : Math.max(hunkStart, nextLine - 1);
    }
    if (text.startsWith(' ')) {
      nextLine += 1;
    }
  }
  return undefined;
}

/** The new side of `@@ -a,b +c,d @@`: `c` and `d` (1 when omitted). */
function parseHunkHeader(text: string): { start: number; count: number } | undefined {
  if (!text.startsWith('@@ ')) {
    return undefined;
  }
  const newSide = text.split(' ', 3)[2];
  if (newSide?.startsWith('+') !== true) {
    return undefined;
  }
  const [start, count = '1'] = newSide.slice(1).split(',', 2);
  return { start: Number(start), count: Number(count) };
}
