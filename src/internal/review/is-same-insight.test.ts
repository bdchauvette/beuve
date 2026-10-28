import { describe, expect, it } from 'vitest';

import type { InsightIdentity } from './is-same-insight.ts';
import { isSameInsight } from './is-same-insight.ts';

const base: InsightIdentity = {
  path: 'src/a.ts',
  lineStart: 10,
  lineEnd: 12,
  category: 'security',
  title: 'Path traversal in join',
};

describe('isSameInsight', () => {
  it('matches the same observation, ignoring case, punctuation and spacing in the title', () => {
    expect(isSameInsight(base, { ...base, title: ' path  TRAVERSAL in join. ' })).toBe(true);
  });

  it('matches overlapping ranges, including touching ends', () => {
    expect(isSameInsight(base, { ...base, lineStart: 12, lineEnd: 20 })).toBe(true);
    expect(isSameInsight(base, { ...base, lineStart: 11, lineEnd: 11 })).toBe(true);
  });

  it.each([
    ['another path', { path: 'src/b.ts' }],
    ['disjoint lines', { lineStart: 13, lineEnd: 14 }],
    ['another category', { category: 'edge-case' as const }],
    ['a different title', { title: 'Path traversal in resolve' }],
    ['a reworded title', { title: 'Path traversal' }],
  ])('does not match %s', (_name, change) => {
    expect(isSameInsight(base, { ...base, ...change })).toBe(false);
  });
});
