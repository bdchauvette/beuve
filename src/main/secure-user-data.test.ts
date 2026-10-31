import { chmod, mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from './testing/test.ts';
import { secureUserData } from './secure-user-data.ts';

describe('secureUserData (ADR 0082)', () => {
  test('makes an older install’s directory and known files owner-only', async ({
    expect,
    tempDir,
    logger,
    signal,
  }) => {
    const userData = path.join(tempDir, 'beuve');
    await mkdir(path.join(userData, 'worktrees'), { recursive: true });
    await chmod(userData, 0o755);
    await chmod(path.join(userData, 'worktrees'), 0o755);
    await writeFile(path.join(userData, 'beuve.db'), '', { mode: 0o644, signal });
    await writeFile(path.join(userData, 'settings.json'), '{}', { mode: 0o664, signal });
    await writeFile(path.join(userData, 'model-secrets.json'), '{}', { mode: 0o600, signal });
    await writeFile(path.join(userData, 'unrelated.txt'), '', { mode: 0o644, signal });

    const secured = await secureUserData(userData, logger.logger);

    expect(secured.tightened).toStrictEqual(['.', 'worktrees', 'beuve.db', 'settings.json']);
    await expect(
      Promise.all(
        ['.', 'worktrees', 'trace', 'beuve.db', 'settings.json', 'model-secrets.json'].map(
          async (name) => permissionsOf(userData, name),
        ),
      ),
    ).resolves.toStrictEqual([0o700, 0o700, 0o700, 0o600, 0o600, 0o600]);
    await expect(permissionsOf(userData, 'unrelated.txt')).resolves.toBe(0o644);
    await expect(secureUserData(userData, logger.logger)).resolves.toStrictEqual({
      tightened: [],
    });
  });

  test('only clears bits, so a read-only file stays read-only', async ({
    expect,
    tempDir,
    logger,
    signal,
  }) => {
    await writeFile(path.join(tempDir, 'mcp-token'), 'token\n', { mode: 0o444, signal });
    await secureUserData(tempDir, logger.logger);
    await expect(permissionsOf(tempDir, 'mcp-token')).resolves.toBe(0o400);
  });

  test('does not follow a symlink out of userData', async ({ expect, tempDir, logger, signal }) => {
    const userData = path.join(tempDir, 'beuve');
    await mkdir(userData, { mode: 0o700 });
    const outside = path.join(tempDir, 'outside.json');
    await writeFile(outside, '{}', { mode: 0o644, signal });
    await symlink(outside, path.join(userData, 'settings.json'));

    const secured = await secureUserData(userData, logger.logger);

    expect(secured.tightened).toStrictEqual([]);
    await expect(permissionsOf(outside)).resolves.toBe(0o644);
    expect(logger.lines).toMatchObject([
      {
        level: 'warn',
        message: 'could not make a userData path owner-only',
        path: 'settings.json',
      },
    ]);
  });
});

async function permissionsOf(...segments: string[]): Promise<number> {
  const { mode } = await stat(path.join(...segments));
  return mode & 0o777;
}
