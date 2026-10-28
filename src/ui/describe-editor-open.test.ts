import { describe, expect, it } from 'vitest';

import { describeEditorOpen } from './describe-editor-open.ts';

describe('describeEditorOpen', () => {
  it('names the editor and flags a beuve checkout', () => {
    const opened = {
      kind: 'opened',
      editorId: 'zed',
      editorName: 'Zed',
      path: 'src/a.ts',
      line: 4,
    } as const;
    expect(describeEditorOpen({ ...opened, location: 'working-tree' })).toEqual({
      tone: 'info',
      text: 'Opened src/a.ts:4 in Zed.',
    });
    expect(describeEditorOpen({ ...opened, location: 'beuve-checkout' }).text).toContain(
      'beuve checkout',
    );
  });

  it('shows failures as errors', () => {
    expect(
      describeEditorOpen({ kind: 'failed', failure: 'launch-failed', message: 'nope' }),
    ).toEqual({ tone: 'error', text: 'nope' });
  });
});
