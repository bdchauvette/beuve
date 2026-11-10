import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { waitUntil } from '../testing/wait-until.ts';
import { test } from './testing/test.ts';

/** The marker the shell prints when the typed line's command succeeds. */
function markerIn(typed: string): string {
  const nonce = /beuve-setup;(?<nonce>[\da-f]+)/u.exec(typed)?.groups?.['nonce'] ?? '';
  return `\u{1B}]7703;beuve-setup;${nonce}\u{7}`;
}

describe('createSetupServices (integration: git worktrees + a fake pty)', () => {
  test('suggests a command from the head and keys it by the GitHub remote', async ({
    expect,
    services,
    openSession,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    await expect(
      services.setup.status({ sessionId, expectedHeadSha: headSha }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        kind: 'ready',
        sessionId,
        headSha,
        repository: 'github.com/acme/widgets',
        suggestion: 'npm ci',
        isSetUp: false,
      },
    });
    await expect(
      services.setup.setCommand({ sessionId, command: 'npm ci # deps' }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    await expect(
      services.setup.setCommand({ sessionId, command: 'npm ci && npm run build;' }, { signal }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { repository: 'github.com/acme/widgets', command: 'npm ci && npm run build' },
    });
    await expect(
      services.setup.status({ sessionId, expectedHeadSha: headSha }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { command: 'npm ci && npm run build' } });
  });

  test('types the command into a new terminal and records only a success', async ({
    expect,
    services,
    openSession,
    fakePty,
    setupFinished,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    okValueFrom(await services.setup.setCommand({ sessionId, command: 'npm ci' }, { signal }));
    const terminal = okValueFrom(
      await services.setup.run(
        { sessionId, expectedHeadSha: headSha, cols: 80, rows: 24 },
        { signal },
      ),
    );
    expect(terminal).toMatchObject({ sessionId, headSha, title: 'setup', isRunning: true });
    const [typed = ''] = fakePty.writes;
    expect(typed).toMatch(
      /^begin; npm ci; end; and printf '\\033\]7703;beuve-setup;[\da-f]+\\007'\r$/u,
    );
    const marker = markerIn(typed);
    fakePty.emit(`${typed}\r\nadded 3 packages\r\n`);
    fakePty.emit('\u{1B}]7703;beuve-setup;00\u{7}');
    expect(setupFinished).toStrictEqual([]);
    fakePty.emit(marker.slice(0, 5));
    fakePty.emit(`${marker.slice(5)}$ `);
    expect(setupFinished).toStrictEqual([{ sessionId, headSha, terminalId: terminal.id }]);
    await expect(
      services.setup.status({ sessionId, expectedHeadSha: headSha }, { signal }),
    ).resolves.toMatchObject({ ok: true, value: { isSetUp: true } });
    await waitUntil(() => {
      return okValueFrom(services.terminal.list({ sessionId })).terminals[0]?.backlog !== '';
    }, 'the setup terminal’s output');
  });

  test('refuses to run without a command, at a moved head, or without a remote', async ({
    expect,
    services,
    openSession,
    fakePty,
    repo,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    const size = { cols: 80, rows: 24 };
    await expect(
      services.setup.run({ sessionId, expectedHeadSha: headSha, ...size }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    await expect(
      services.setup.run({ sessionId, expectedHeadSha: 'f'.repeat(40), ...size }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale-review' } });
    await repo.git('remote', 'remove', 'origin');
    await expect(
      services.setup.status({ sessionId, expectedHeadSha: headSha }, { signal }),
    ).resolves.toStrictEqual({ ok: true, value: { kind: 'no-remote', sessionId, headSha } });
    await expect(
      services.setup.setCommand({ sessionId, command: 'npm ci' }, { signal }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(fakePty.spawned).toHaveLength(0);
  });
});
