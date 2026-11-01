import { realpath } from 'node:fs/promises';

import { describe } from 'vitest';

import type { TerminalSize } from '#internal/terminal/pty-process.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { waitUntil } from '../testing/wait-until.ts';
import { test } from './testing/test.ts';

describe('createTerminalServices (integration: git worktrees + a fake pty)', () => {
  test('opens the login shell in beuve’s checkout, not the user’s clone', async ({
    expect,
    services,
    openSession,
    fakePty,
    repo,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    const terminal = okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    expect(terminal).toMatchObject({ sessionId, headSha, title: 'fish', isRunning: true });
    const [spawn] = fakePty.spawned;
    expect(spawn).toMatchObject({ file: '/bin/fish', args: ['-l'], size: size() });
    const cwd = await realpath(spawn?.cwd ?? '');
    expect(cwd).not.toBe(await realpath(repo.directory));
    expect(cwd.endsWith(headSha)).toBe(true);
    expect(spawn?.env).toMatchObject({
      TERM: 'xterm-256color',
      TERM_PROGRAM_VERSION: '9.9.9',
      BEUVE_CHECKOUT: spawn?.cwd,
      BEUVE_HEAD_SHA: headSha,
      BEUVE_SESSION_ID: sessionId,
      BEUVE_REPOSITORY: repo.directory,
      PATH: '/usr/bin',
    });
    expect(spawn?.env).not.toHaveProperty('ELECTRON_ENABLE_LOGGING');
  });

  test('refuses a head that moved, and starts nothing', async ({
    expect,
    services,
    openSession,
    fakePty,
    signal,
  }) => {
    const { sessionId } = await openSession();
    const result = await services.terminal.open(
      {
        sessionId,
        expectedHeadSha: 'f'.repeat(40),
        ...size(),
      },
      { signal },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'stale-review' } });
    expect(fakePty.spawned).toHaveLength(0);
  });

  test('reports a shell that cannot start', async ({
    expect,
    services,
    openSession,
    fakePty,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    fakePty.failNextSpawn('posix_spawnp failed');
    const result = await services.terminal.open(
      { sessionId, expectedHeadSha: headSha, ...size() },
      { signal },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(JSON.stringify(result)).toContain('posix_spawnp failed');
    expect(okValueFrom(services.terminal.list({ sessionId })).terminals).toHaveLength(0);
  });

  test('batches output, numbers it, and replays it for a reloaded renderer', async ({
    expect,
    services,
    openSession,
    fakePty,
    terminalData,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    const terminal = okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    fakePty.emit('hel');
    fakePty.emit('lo\r\n');
    await waitUntil(() => {
      return terminalData.length > 0;
    }, 'terminal output');
    expect(terminalData).toStrictEqual([{ terminalId: terminal.id, data: 'hello\r\n', end: 7 }]);
    fakePty.emit('$ ');
    const listed = okValueFrom(services.terminal.list({ sessionId })).terminals;
    expect(listed).toMatchObject([{ id: terminal.id, backlog: 'hello\r\n', backlogEnd: 7 }]);
    await waitUntil(() => {
      return terminalData.length > 1;
    }, 'more terminal output');
    expect(terminalData.at(-1)).toMatchObject({ data: '$ ', end: 9 });
  });

  test('passes keystrokes and resizes to the shell', async ({
    expect,
    services,
    openSession,
    fakePty,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    const { id } = okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    okValueFrom(services.terminal.write({ terminalId: id, data: 'ls\r' }));
    okValueFrom(services.terminal.resize({ terminalId: id, cols: 120, rows: 40 }));
    expect(fakePty.writes).toStrictEqual(['ls\r']);
    expect(fakePty.resizes).toStrictEqual([{ cols: 120, rows: 40 }]);
    expect(services.terminal.write({ terminalId: 'nope', data: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  test('keeps an ended terminal’s output, refuses input, and tells the renderer', async ({
    expect,
    services,
    openSession,
    fakePty,
    terminalExits,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    const { id } = okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    fakePty.emit('bye\r\n');
    fakePty.exit({ exitCode: 3, signal: undefined });
    expect(terminalExits).toStrictEqual([{ terminalId: id, exitCode: 3, signal: undefined }]);
    const [listed] = okValueFrom(services.terminal.list({ sessionId })).terminals;
    expect(listed).toMatchObject({ isRunning: false, backlog: 'bye\r\n' });
    expect(services.terminal.write({ terminalId: id, data: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    okValueFrom(services.terminal.close({ terminalId: id }));
    expect(fakePty.killCount()).toBe(0);
  });

  test('close hangs up a running shell and forgets the terminal', async ({
    expect,
    services,
    openSession,
    fakePty,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    const { id } = okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    okValueFrom(services.terminal.close({ terminalId: id }));
    expect(fakePty.killCount()).toBe(1);
    expect(okValueFrom(services.terminal.list({ sessionId })).terminals).toHaveLength(0);
    expect(services.terminal.close({ terminalId: id })).toMatchObject({ ok: false });
  });

  test('disposing the services hangs up every shell', async ({
    expect,
    services,
    openSession,
    fakePty,
    signal,
  }) => {
    const { sessionId, headSha } = await openSession();
    okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    okValueFrom(
      await services.terminal.open({ sessionId, expectedHeadSha: headSha, ...size() }, { signal }),
    );
    services.terminal.dispose();
    expect(fakePty.killCount()).toBe(2);
  });
});

function size(): TerminalSize {
  return { cols: 100, rows: 30 };
}
