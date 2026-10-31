import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeEditorOpen } from './describe-editor-open.ts';

describe('describeEditorOpen', () => {
  test('names the editor and flags a beuve checkout', ({ expect }) => {
    const opened = {
      kind: 'opened',
      editorId: 'zed',
      editorName: 'Zed',
      path: 'src/a.ts',
      line: 4,
    } as const;
    expect(describeEditorOpen({ ...opened, location: 'working-tree' })).toStrictEqual({
      tone: 'info',
      text: 'Opened src/a.ts:4 in Zed.',
    });
    expect(describeEditorOpen({ ...opened, location: 'beuve-checkout' }).text).toContain(
      'read-only beuve checkout',
    );
  });

  test('shows failures as errors', ({ expect }) => {
    expect(
      describeEditorOpen({ kind: 'failed', failure: 'launch-failed', message: 'nope' }),
    ).toStrictEqual({ tone: 'error', text: 'nope' });
  });
});
