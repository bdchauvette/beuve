import { describe, expect, it } from 'vitest';

import { createViewMapper } from './create-view-mapper.ts';
import { LineIndex } from './line-index.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { positionEncodings } from './position-encodings.ts';

const root = '/w' as WorkspaceRoot;
const uri = 'file:///w/src/a.ts';
const lines = new LineIndex('const 😀 = 1;\n');

describe('createViewMapper', () => {
  const mapper = createViewMapper({
    root,
    encoding: positionEncodings.utf8,
    lines: (key) => (key === uri ? lines : undefined),
  });
  const utf8Range = { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } };

  it('converts diagnostics to UTF-16 columns and readable fields', () => {
    expect(
      mapper.diagnostic(uri, {
        range: utf8Range,
        severity: 1,
        code: 2322,
        message: 'm',
        tags: [1, 2, 9],
        relatedInformation: [
          { location: { uri: 'file:///elsewhere.ts', range: utf8Range }, message: 'r' },
        ],
      }),
    ).toEqual({
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 8 } },
      severity: 'error',
      code: '2322',
      source: undefined,
      message: 'm',
      tags: ['unnecessary', 'deprecated'],
      related: [
        {
          location: { file: { kind: 'external', uri: 'file:///elsewhere.ts' }, range: utf8Range },
          message: 'r',
        },
      ],
    });
  });

  it('maps call hierarchy items to nodes with kind names', () => {
    expect(
      mapper.node('id-1', {
        name: 'f',
        kind: 12,
        detail: '',
        uri,
        range: utf8Range,
        selectionRange: utf8Range,
      }),
    ).toEqual({
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
