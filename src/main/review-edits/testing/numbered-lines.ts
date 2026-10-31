/** Ten numbered lines, `line 1` … `line 10`, with line `n` replaced by `changed[n]`. */
export function numberedLines(changed: Readonly<Record<number, string>> = {}): string {
  return Array.from({ length: 10 }, (_, index) => {
    return changed[index + 1] ?? `line ${String(index + 1)}`;
  })
    .map((line) => `${line}\n`)
    .join('');
}
