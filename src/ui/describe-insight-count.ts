/** "1 insight" or "2 insights": the badge on a collapsed card that holds `/review` findings (ADR 0061). */
export function describeInsightCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'insight' : 'insights'}`;
}
