import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { RequestScopes } from './request-scopes.ts';

describe('RequestScopes', () => {
  test('a newer request of a kind supersedes the window’s older one, and nothing else', ({
    expect,
  }) => {
    const scopes = new RequestScopes();
    using older = scopes.begin(1, 'review');
    using otherKind = scopes.begin(1, 'order');
    using otherWindow = scopes.begin(2, 'review');
    using newer = scopes.begin(1, 'review');
    expect(older.signal.aborted).toBe(true);
    expect([otherKind, otherWindow, newer].map(({ signal }) => signal.aborted)).toStrictEqual([
      false,
      false,
      false,
    ]);
  });

  test('cancels a request by id, only from its own window', ({ expect }) => {
    const scopes = new RequestScopes();
    using opening = scopes.begin(1, 'open-pull-request', 'r1');
    expect(scopes.cancel(2, 'r1')).toBe(false);
    expect(opening.signal.aborted).toBe(false);
    expect(scopes.cancel(1, 'r1')).toBe(true);
    expect(opening.signal.aborted).toBe(true);
  });

  test('closing a window aborts everything it has outstanding', ({ expect }) => {
    const scopes = new RequestScopes();
    using review = scopes.begin(1, 'review');
    using sheet = scopes.begin(1, 'sheet-file');
    using elsewhere = scopes.begin(2, 'review');
    scopes.closeWindow(1);
    expect([review, sheet, elsewhere].map(({ signal }) => signal.aborted)).toStrictEqual([
      true,
      true,
      false,
    ]);
  });

  test('a finished request is forgotten: no later request or cancel touches it', ({ expect }) => {
    const scopes = new RequestScopes();
    const finished = (): AbortSignal => {
      using done = scopes.begin(1, 'review', 'r1');
      return done.signal;
    };
    const signal = finished();
    expect(scopes.cancel(1, 'r1')).toBe(false);
    using _next = scopes.begin(1, 'review');
    expect(signal.aborted).toBe(false);
  });
});
