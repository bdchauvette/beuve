import { describe } from 'vitest';

import { describeOpenAppDatabaseError } from './describe-open-app-database-error.ts';
import { test } from '../testing/test.ts';

describe('describeOpenAppDatabaseError', () => {
  test('names the database, the migrations it doesn’t know, and the way out', ({ expect }) => {
    expect(
      describeOpenAppDatabaseError({
        kind: 'newer-database',
        location: '/home/r/.config/beuve/beuve.db',
        unknownIds: ['ura-0003-x', 'chat-0003-y'],
      }),
    ).toStrictEqual({
      message: 'beuve’s database was written by a newer version of beuve',
      detail:
        '/home/r/.config/beuve/beuve.db has schema changes this version doesn’t know (ura-0003-x, chat-0003-y), so beuve left it untouched and can’t start on it.\n\nInstall the newer version of beuve to keep using it.',
    });
  });

  test('reveals format controls in the path', ({ expect }) => {
    const { detail } = describeOpenAppDatabaseError({
      kind: 'newer-database',
      location: '/tmp/\u{202E}bd.db',
      unknownIds: ['x'],
    });
    expect(detail).toContain('/tmp/⟨U+202E⟩bd.db');
  });
});
