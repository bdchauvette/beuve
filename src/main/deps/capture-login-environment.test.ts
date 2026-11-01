import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { captureLoginEnvironment } from './capture-login-environment.ts';

describe('captureLoginEnvironment (ADR 0089)', () => {
  test('runs the login shell from $HOME and keeps PATH and tool variables only', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const home = path.join(tempDir, 'home');
    mkdirSync(home);
    const shell = fakeShell({
      directory: tempDir,
      rc: 'export PATH="/opt/tools/bin:$PATH" MISE_SHELL=zsh TOKEN=s3cret',
    });
    const captured = await captureLoginEnvironment({ shell, home, signal });
    expect(captured.ok).toBe(true);
    expect(captured).toMatchObject({
      value: { MISE_SHELL: 'zsh', PATH: expect.stringMatching(/^\/opt\/tools\/bin:/u) as unknown },
    });
    expect(captured).not.toMatchObject({ value: { TOKEN: 's3cret' } });
    expect(readFileSync(path.join(tempDir, 'shell-ran'), 'utf8').trim().split(' ')).toStrictEqual([
      '-i',
      '-l',
      '-c',
      home,
    ]);
  });

  test('gives up on a shell that hangs, and on one that prints nothing', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const hanging = fakeShell({ directory: tempDir, rc: 'sleep 30' });
    await expect(
      captureLoginEnvironment({
        shell: hanging,
        home: tempDir,
        signal,
        timeout: Temporal.Duration.from({ milliseconds: 300 }),
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('in time') as unknown });
    const silent = path.join(tempDir, 'silent');
    writeFileSync(silent, '#!/bin/sh\nexit 0\n');
    chmodSync(silent, 0o755);
    await expect(
      captureLoginEnvironment({ shell: silent, home: tempDir, signal }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('no environment') as unknown,
    });
  });
});

/** A `/bin/sh` standing in for the login shell: records its flags and directory, runs `rc`, then the command. */
/** Where to write the fake shell, and the shell code its `rc` runs. */
interface FakeShell {
  readonly directory: string;
  readonly rc: string;
}

function fakeShell({ directory, rc }: FakeShell): string {
  const shell = path.join(directory, 'fake-shell');
  writeFileSync(
    shell,
    `#!/bin/sh\necho "$1 $2 $3 $PWD" > '${path.join(directory, 'shell-ran')}'\n${rc}\nexec /bin/sh -c "$4"\n`,
  );
  chmodSync(shell, 0o755);
  return shell;
}
