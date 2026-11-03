import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createViewMapper } from './create-view-mapper.ts';
import type { ViewMapper } from './create-view-mapper.ts';
import { LineIndex } from './line-index.ts';
import type { LspRange } from './lsp-protocol.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { positionEncodings } from './position-encodings.ts';

function uri(): string {
  return 'file:///w/src/a.ts';
}

function mapper(): ViewMapper {
  const lines = new LineIndex('const 😀 = 1;\n');
  return createViewMapper({
    root: '/w' as WorkspaceRoot,
    encoding: positionEncodings.utf8,
    lines: (key) => {
      if (key === uri()) {
        return lines;
      }
      return;
    },
  });
}

function utf8Range(): LspRange {
  return { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } };
}

describe('createViewMapper', () => {
  test('maps call hierarchy items to nodes with kind names', ({ expect }) => {
    expect(
      mapper().node('id-1', {
        name: 'f',
        kind: 12,
        detail: '',
        uri: uri(),
        range: utf8Range(),
        selectionRange: utf8Range(),
      }),
    ).toStrictEqual({
      id: 'id-1',
      name: 'f',
      kind: 'function',
      detail: undefined,
      file: { kind: 'workspace', path: 'src/a.ts' },
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 8 } },
      selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 8 } },
    });
  });
});
