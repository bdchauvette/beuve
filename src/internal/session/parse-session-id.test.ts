import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseSessionId } from './parse-session-id.ts';

describe('parseSessionId', () => {
  it('accepts a randomUUID and rejects anything else', () => {
    const id = randomUUID();
    expect(parseSessionId(id)).toEqual({ ok: true, value: id });
    expect(parseSessionId('nope')).toEqual({
      ok: false,
      error: { kind: 'invalid-session-id', value: 'nope' },
    });
  });
});
