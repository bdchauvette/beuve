import type { AgentInsight } from './agent-insight.ts';

/** The fields {@link isSameInsight} compares. */
export type InsightIdentity = Pick<
  AgentInsight,
  'path' | 'lineStart' | 'lineEnd' | 'category' | 'title'
>;

/**
 * Whether two insights, from different runs at the same head, are the same observation: the same
 * path, overlapping line ranges, the same category and the same title once case, punctuation and
 * whitespace are ignored. Deliberately conservative: a reworded title is a new insight.
 */
export function isSameInsight(left: InsightIdentity, right: InsightIdentity): boolean {
  return (
    left.path === right.path &&
    left.category === right.category &&
    left.lineStart <= right.lineEnd &&
    right.lineStart <= left.lineEnd &&
    normalizeTitle(left.title) === normalizeTitle(right.title)
  );
}

function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
