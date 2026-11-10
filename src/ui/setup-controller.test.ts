import { describe } from 'vitest';

import type { BeuveApi, SetupStatusView } from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';
import { SetupController } from './setup-controller.ts';
import type { SetupTarget } from './setup-controller.ts';
import { createFakeBridge } from './testing/create-fake-bridge.ts';
import type { FakeBridge } from './testing/create-fake-bridge.ts';
import { createFakeHost } from './testing/create-fake-host.ts';

import { test } from './testing/test.ts';

interface Harness {
  readonly setup: SetupController;
  readonly fake: FakeBridge;
  readonly notices: StatusNotice[];
  readonly runs: () => number;
  /** Moves the review to another head. */
  readonly moveTo: (headSha: string) => void;
}

function createHarness(status: SetupStatusView, saveReply?: unknown): Harness {
  const fake = createFakeBridge({
    replies: {
      'setup:status': { ok: true, value: status },
      'setup:set-command': saveReply ?? {
        ok: true,
        value: { repository: 'github.com/acme/widgets', command: 'npm ci' },
      },
    },
  });
  const { host } = createFakeHost();
  const notices: StatusNotice[] = [];
  let runs = 0;
  let target: SetupTarget = { sessionId: 's1', headSha: 'a'.repeat(40) };
  const setup = new SetupController(host, {
    bridge: (): BeuveApi => {
      return fake.bridge;
    },
    target: (): SetupTarget => {
      return target;
    },
    notify: (notice): void => {
      notices.push(notice);
    },
    startRun: (): void => {
      runs += 1;
    },
  });
  return {
    setup,
    fake,
    notices,
    runs: (): number => {
      return runs;
    },
    moveTo: (headSha): void => {
      target = { ...target, headSha };
    },
  };
}

function ready(overrides: Partial<Extract<SetupStatusView, { kind: 'ready' }>>): SetupStatusView {
  return {
    kind: 'ready',
    sessionId: 's1',
    headSha: 'a'.repeat(40),
    repository: 'github.com/acme/widgets',
    suggestion: 'npm ci',
    isSetUp: false,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SetupController', () => {
  test('asks for the command first, then saves it and runs it', async ({ expect }) => {
    const { setup, fake, runs } = createHarness(ready({}));
    await setup.run();
    expect(setup.dialog).toStrictEqual({
      repository: 'github.com/acme/widgets',
      command: 'npm ci',
      error: '',
      runsAfterSave: true,
    });
    expect(runs()).toBe(0);
    await setup.save('npm ci && npm run build');
    expect(fake.invoked.at(-1)).toStrictEqual([
      'setup:set-command',
      { sessionId: 's1', command: 'npm ci && npm run build' },
    ]);
    expect(setup.dialog).toBeUndefined();
    expect(runs()).toBe(1);
  });

  test('runs a stored command straight away, and edits it without running', async ({ expect }) => {
    const { setup, runs, notices } = createHarness(ready({ command: 'pnpm i' }));
    await setup.run();
    expect(runs()).toBe(1);
    await setup.edit();
    expect(setup.dialog).toMatchObject({ command: 'pnpm i', runsAfterSave: false });
    await setup.save('pnpm i');
    expect(runs()).toBe(1);
    expect(notices.at(-1)).toMatchObject({ tone: 'info' });
  });

  test('keeps the dialog open with the reason a command was refused', async ({ expect }) => {
    const refused = { ok: false, error: { code: 'invalid-request', message: 'One line.' } };
    const { setup, runs } = createHarness(ready({}), refused);
    await setup.run();
    await setup.save('a\nb');
    expect(setup.dialog).toMatchObject({ command: 'a\nb', error: 'One line.' });
    expect(runs()).toBe(0);
  });

  test('says why there is no setup without a remote', async ({ expect }) => {
    const { setup, notices, runs } = createHarness({
      kind: 'no-remote',
      sessionId: 's1',
      headSha: 'a'.repeat(40),
    });
    await setup.run();
    expect(setup.dialog).toBeUndefined();
    expect(runs()).toBe(0);
    expect(notices).toMatchObject([{ tone: 'info' }]);
  });

  test('offers Run Setup once for each head that is not set up', async ({ expect }) => {
    const { setup, notices, fake, moveTo } = createHarness(ready({ command: 'npm ci' }));
    setup.observe();
    setup.observe();
    await flush();
    expect(notices).toStrictEqual([
      {
        tone: 'info',
        text: 'This checkout is not set up yet.',
        action: { label: 'Run Setup', command: 'run-setup' },
      },
    ]);
    moveTo('b'.repeat(40));
    setup.observe();
    await flush();
    expect(fake.invoked.filter(([channel]) => channel === 'setup:status')).toHaveLength(2);
    expect(notices).toHaveLength(2);
  });

  test('offers nothing for a set-up head or a repository without a command', async ({ expect }) => {
    const done = createHarness(ready({ command: 'npm ci', isSetUp: true }));
    done.setup.observe();
    const noCommand = createHarness(ready({}));
    noCommand.setup.observe();
    await flush();
    expect([...done.notices, ...noCommand.notices]).toStrictEqual([]);
  });

  test('offers Restart Language Servers when the session’s setup finishes', ({ expect }) => {
    const { setup, fake, notices } = createHarness(ready({}));
    setup.hostConnected();
    fake.emit('setup:finished', { sessionId: 's2', headSha: 'a'.repeat(40), terminalId: 't' });
    fake.emit('setup:finished', { sessionId: 's1', headSha: 'a'.repeat(40), terminalId: 't' });
    expect(notices).toMatchObject([
      { action: { label: 'Restart Language Servers', command: 'restart-language-servers' } },
    ]);
    setup.hostDisconnected();
    expect(fake.listening()).toBe(0);
  });
});
