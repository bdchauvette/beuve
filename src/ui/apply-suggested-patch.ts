const hunkHeader = /^@@ -([\d,]+) \+[\d,]+ @@/u;

/**
 * The head file with a suggested patch applied, so re-editing a suggestion (ADR 0043) starts
 * from the suggested text rather than the head. Every context and removed line must match the
 * head exactly; `undefined` when the patch doesn't apply (then the editor starts from the head).
 * A `\ No newline at end of file` after an added last line drops the final newline.
 */
export function applySuggestedPatch(head: string, patch: string): string | undefined {
  const source = head.endsWith('\n') ? head.slice(0, -1).split('\n') : head.split('\n');
  const isHeadEmpty = head === '';
  const lines = patch.endsWith('\n') ? patch.slice(0, -1).split('\n') : patch.split('\n');
  const output: string[] = [];
  let next = 0;
  let hasFinalNewline = head.endsWith('\n') || isHeadEmpty;
  let lastKind = '';
  let isInHunk = false;
  for (const line of lines) {
    const header = hunkHeader.exec(line);
    if (header !== null) {
      const [start = '', count = '1'] = (header[1] ?? '').split(',', 2);
      const oldStart = Number(start);
      const oldCount = Number(count);
      const first = oldCount === 0 ? oldStart : oldStart - 1;
      if (first < next || first > source.length) {
        return undefined;
      }
      output.push(...source.slice(next, first));
      next = first;
      isInHunk = true;
      continue;
    }
    if (!isInHunk) {
      continue;
    }
    const kind = line[0] ?? ' ';
    if (kind === '\\') {
      if (lastKind === '+') {
        hasFinalNewline = false;
      }
      continue;
    }
    lastKind = kind;
    const text = line.slice(1);
    if (kind === '+') {
      output.push(text);
      hasFinalNewline = true;
      continue;
    }
    if (source[next] !== text || (kind !== ' ' && kind !== '-')) {
      return undefined;
    }
    if (kind === ' ') {
      output.push(text);
    }
    next += 1;
  }
  output.push(...(isHeadEmpty ? [] : source.slice(next)));
  if (next < source.length) {
    hasFinalNewline = head.endsWith('\n');
  }
  const text = output.join('\n');
  return output.length === 0 ? '' : hasFinalNewline ? `${text}\n` : text;
}
