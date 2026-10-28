import { describe, expect, it } from 'vitest';

import { badgeCallHierarchyNode } from './badge-call-hierarchy-node.ts';

const node = {
  file: { kind: 'workspace', path: 'src/b.ts' },
  range: { start: { line: 2, character: 0 }, end: { line: 4, character: 1 } },
} as const;

describe('badgeCallHierarchyNode', () => {
  it('marks nodes whose lines overlap a changed span as modified', () => {
    expect(
      badgeCallHierarchyNode(node, new Map([['src/b.ts', [{ startLine: 5, endLine: 9 }]]])),
    ).toBe('modified');
    expect(
      badgeCallHierarchyNode(node, new Map([['src/b.ts', [{ startLine: 1, endLine: 3 }]]])),
    ).toBe('modified');
    expect(
      badgeCallHierarchyNode(node, new Map([['src/b.ts', [{ startLine: 6, endLine: 8 }]]])),
    ).toBe('untouched');
    expect(
      badgeCallHierarchyNode(node, new Map([['src/a.ts', [{ startLine: 3, endLine: 3 }]]])),
    ).toBe('untouched');
  });

  it('does not count the line a range ends at column 0', () => {
    const endsAtLineStart = {
      ...node,
      range: { start: { line: 2, character: 0 }, end: { line: 5, character: 0 } },
    };
    expect(
      badgeCallHierarchyNode(
        endsAtLineStart,
        new Map([['src/b.ts', [{ startLine: 6, endLine: 6 }]]]),
      ),
    ).toBe('untouched');
  });

  it('marks files outside the workspace as external', () => {
    expect(
      badgeCallHierarchyNode(
        { ...node, file: { kind: 'external', uri: 'file:///lib.d.ts' } },
        new Map(),
      ),
    ).toBe('external');
  });
});
