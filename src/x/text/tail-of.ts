/**
 * The last `maxLength` UTF-16 code units of `text`, without a lone low surrogate at the start:
 * `text.slice(-n)` can cut an astral character in half, and the orphan turns into U+FFFD or
 * makes a strict UTF-8 encoder throw. The result may therefore be one unit shorter.
 */
export function tailOf(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  const tail = text.slice(text.length - maxLength);
  return isLowSurrogate(tail.codePointAt(0) ?? 0) ? tail.slice(1) : tail;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc_00 && unit <= 0xdf_ff;
}
