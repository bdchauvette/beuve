/** `1st`, `2nd`, `3rd`, `11th`, `97th`, for a non-negative integer. */
export function formatOrdinal(value: number): string {
  const isTeen = value % 100 >= 11 && value % 100 <= 13;
  const suffixes: Readonly<Partial<Record<number, string>>> = { 1: 'st', 2: 'nd', 3: 'rd' };
  return `${String(value)}${isTeen ? 'th' : (suffixes[value % 10] ?? 'th')}`;
}
