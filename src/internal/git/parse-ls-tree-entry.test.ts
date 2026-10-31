import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseLsTreeEntry } from './parse-ls-tree-entry.ts';

function oid(): string {
  return 'a'.repeat(40);
}

describe('parseLsTreeEntry', () => {
  test('reads mode, type, object and the path verbatim, tabs and quotes included', ({ expect }) => {
    expect(parseLsTreeEntry(`100644 blob ${oid()}\tdir/a"b\tc.ts`)).toStrictEqual({
      mode: '100644',
      type: 'blob',
      objectId: oid(),
      path: 'dir/a"b\tc.ts',
    });
    expect(parseLsTreeEntry(`160000 commit ${oid()}\tsub`)).toMatchObject({ type: 'commit' });
  });

  test.for(['', 'blob x path', `100644 blob ${oid()} path`, `100644 blob ${oid()}\t`])(
    'refuses %j',
    (line, { expect }) => {
      expect(parseLsTreeEntry(line)).toBeUndefined();
    },
  );
});
