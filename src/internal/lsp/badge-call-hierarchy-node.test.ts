import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { badgeCallHierarchyNode } from './badge-call-hierarchy-node.ts';
import type { CallHierarchyNode } from './lsp-model.ts';

function node(): Pick<CallHierarchyNode, 'file' | 'range'> {
  return {
    file: { kind: 'workspace', path: 'src/b.ts' },
    range: { start: { line: 2, character: 0 }, end: { line: 4, character: 1 } },
  };
}

describe('badgeCallHierarchyNode', () => {
  test('marks nodes whose lines overlap a changed span as modified', ({ expect }) => {
    expect(
      badgeCallHierarchyNode(node(), new Map([['src/b.ts', [{ startLine: 5, endLine: 9 }]]])),
    ).toBe('modified');
    expect(
      badgeCallHierarchyNode(node(), new Map([['src/b.ts', [{ startLine: 1, endLine: 3 }]]])),
    ).toBe('modified');
    expect(
      badgeCallHierarchyNode(node(), new Map([['src/b.ts', [{ startLine: 6, endLine: 8 }]]])),
    ).toBe('untouched');
    expect(
      badgeCallHierarchyNode(node(), new Map([['src/a.ts', [{ startLine: 3, endLine: 3 }]]])),
    ).toBe('untouched');
  });

  test('does not count the line a range ends at column 0', ({ expect }) => {
    const endsAtLineStart = {
      ...node(),
      range: { start: { line: 2, character: 0 }, end: { line: 5, character: 0 } },
    };
    expect(
      badgeCallHierarchyNode(
        endsAtLineStart,
        new Map([['src/b.ts', [{ startLine: 6, endLine: 6 }]]]),
      ),
    ).toBe('untouched');
  });

  test('marks files outside the workspace as external', ({ expect }) => {
    expect(
      badgeCallHierarchyNode(
        { ...node(), file: { kind: 'external', uri: 'file:///lib.d.ts' } },
        new Map(),
      ),
    ).toBe('external');
  });
});
