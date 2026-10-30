import { randomUUID } from 'node:crypto';

import { parseSessionId } from './parse-session-id.ts';
import { test } from './testing/test.ts';

test('parseSessionId accepts a randomUUID and rejects anything else', ({ expect }) => {
  const id = randomUUID();
  expect(parseSessionId(id)).toStrictEqual({ ok: true, value: id });
  expect(parseSessionId('nope')).toStrictEqual({
    ok: false,
    error: { kind: 'invalid-session-id', value: 'nope' },
  });
});
