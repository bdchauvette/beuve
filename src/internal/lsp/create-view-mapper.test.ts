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
    lines: (key) => (key === uri() ? lines : undefined),
  });
}

function utf8Range(): LspRange {
  return { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } };
}

describe('createViewMapper', () => {
  test('converts diagnostics to UTF-16 columns and readable fields', ({ expect }) => {
    expect(
      mapper().diagnostic(uri(), {
        range: utf8Range(),
        severity: 1,
        code: 2322,
        message: 'm',
        tags: [1, 2, 9],
        relatedInformation: [
          { location: { uri: 'file:///elsewhere.ts', range: utf8Range() }, message: 'r' },
        ],
      }),
    ).toStrictEqual({
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 8 } },
      severity: 'error',
      code: '2322',
      source: undefined,
      message: 'm',
      tags: ['unnecessary', 'deprecated'],
      related: [
        {
          location: { file: { kind: 'external', uri: 'file:///elsewhere.ts' }, range: utf8Range() },
          message: 'r',
        },
      ],
    });
  });

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
