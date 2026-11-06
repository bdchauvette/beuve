import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { resolveProjectCommand } from './resolve-project-command.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

function createProject(directory: string): WorkspaceRoot {
  const root = realpathSync(directory);
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules/lint/bin'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/lint/bin/server.js'), '#!/usr/bin/env node\n');
  chmodSync(path.join(root, 'node_modules/lint/bin/server.js'), 0o755);
  symlinkSync('../lint/bin/server.js', path.join(root, 'node_modules/.bin/lint-server'));
  return root as WorkspaceRoot;
}

describe('resolveProjectCommand', () => {
  test('finds a program relative to the checkout, following a link that stays inside it', async ({
    expect,
    tempDir,
  }) => {
    const workspace = createProject(tempDir);
    await expect(
      resolveProjectCommand({
        serverId: 'lint',
        workspace,
        command: 'node_modules/.bin/lint-server',
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: path.join(workspace, 'node_modules/lint/bin/server.js'),
    });
  });

  test('refuses a path that leaves the checkout, lexically or through a link', async ({
    expect,
    tempDir,
  }) => {
    const workspace = createProject(tempDir);
    writeFileSync(path.join(path.dirname(workspace), 'outside.js'), '');
    symlinkSync(
      path.join(path.dirname(workspace), 'outside.js'),
      path.join(workspace, 'node_modules/.bin/escape'),
    );
    for (const command of ['../outside.js', 'node_modules/.bin/escape']) {
      await expect(
        resolveProjectCommand({ serverId: 'lint', workspace, command }),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: 'server-not-found', serverId: 'lint' },
      });
    }
  });

  test('refuses an absolute path, a missing file and a directory', async ({ expect, tempDir }) => {
    const workspace = createProject(tempDir);
    for (const command of ['/usr/bin/env', 'node_modules/.bin/missing', 'node_modules/lint']) {
      await expect(
        resolveProjectCommand({ serverId: 'lint', workspace, command }),
      ).resolves.toMatchObject({ ok: false, error: { kind: 'server-not-found' } });
    }
  });
});
