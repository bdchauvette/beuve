import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseWorkspaceEdit } from './parse-workspace-edit.ts';

describe('parseWorkspaceEdit', () => {
  test('reads `changes`, joining a document named twice in one spelling', ({ expect }) => {
    const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };
    expect(
      parseWorkspaceEdit({
        changes: {
          'file:///w/a.ts': [{ range, newText: 'x' }, { range }, 'nonsense'],
          'file:///w/%62.ts': [{ range, newText: 'y' }],
          'file:///w/b.ts': [{ range, newText: 'z', annotationId: 'n' }],
          'file:///w/c.ts': 'not a list',
        },
      }),
    ).toStrictEqual({
      files: [
        { uri: 'file:///w/a.ts', edits: [{ range, newText: 'x' }] },
        {
          uri: 'file:///w/b.ts',
          edits: [
            { range, newText: 'y' },
            { range, newText: 'z' },
          ],
        },
      ],
      resourceOperations: 0,
      malformed: 3,
    });
  });

  test('prefers `documentChanges`, counting resource operations and snippet edits as left out', ({
    expect,
  }) => {
    const range = { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } };
    expect(
      parseWorkspaceEdit({
        changes: { 'file:///w/ignored.ts': [{ range, newText: 'no' }] },
        documentChanges: [
          { textDocument: { uri: 'file:///w/a.ts', version: 3 }, edits: [{ range, newText: 'b' }] },
          { kind: 'rename', oldUri: 'file:///w/a.ts', newUri: 'file:///w/b.ts' },
          { kind: 'create', uri: 'file:///w/c.ts' },
          { kind: 'delete', uri: 'file:///w/d.ts' },
          {
            textDocument: { uri: 'file:///w/a.ts', version: JSON.parse('null') as null },
            edits: [{ range, snippet: { kind: 'snippet', value: '$1' } }],
          },
          { kind: 'format' },
        ],
      }),
    ).toStrictEqual({
      files: [{ uri: 'file:///w/a.ts', edits: [{ range, newText: 'b' }] }],
      resourceOperations: 3,
      malformed: 2,
    });
  });

  test.for([
    ['null', JSON.parse('null')],
    ['a string', 'edit'],
    ['an empty object', {}],
    ['changes that are not an object', { changes: 3 }],
  ] as const)('has no edit for %s', ([, value], { expect }) => {
    expect(parseWorkspaceEdit(value)).toStrictEqual({
      files: [],
      resourceOperations: 0,
      malformed: 0,
    });
  });

  test('refuses ranges with negative or fractional positions', ({ expect }) => {
    const bad = { start: { line: -1, character: 0 }, end: { line: 0, character: 0.5 } };
    expect(
      parseWorkspaceEdit({ changes: { 'file:///w/a.ts': [{ range: bad, newText: '' }] } }),
    ).toStrictEqual({
      files: [{ uri: 'file:///w/a.ts', edits: [] }],
      resourceOperations: 0,
      malformed: 1,
    });
  });
});
