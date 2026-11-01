import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../terminal/testing/test.ts';

describe('createLspServices restart (integration: git worktrees, no language server)', () => {
  test('restarts the servers of the session head’s checkout and names the head', async ({
    expect,
    services,
    openSession,
  }) => {
    const { sessionId, headSha } = await openSession();
    const restarted = okValueFrom(await services.lsp.restart({ sessionId }));
    expect(restarted).toStrictEqual({ sessionId, headSha });
  });

  test('refuses a session that does not exist', async ({ expect, services }) => {
    const result = await services.lsp.restart({ sessionId: 'no-such-session' });
    expect(result).toMatchObject({ ok: false });
  });
});
