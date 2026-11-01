import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import type { ToolCandidate, ToolchainKind } from '#internal/deps/dependency-ecosystem.ts';
import { writeFakeTool } from '#internal/deps/testing/write-fake-tool.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { test } from '../testing/test.ts';
import { createToolchainFinder } from './create-toolchain-finder.ts';

describe('createToolchainFinder (ADR 0089, 0091)', () => {
  test('searches the Settings directory, the login PATH, the known directories, then beuve’s', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const directories = ['override', 'login', 'known', 'inherited'].map((name) => {
      const directory = path.join(tempDir, name);
      mkdirSync(directory);
      return directory;
    });
    const [override = '', login = '', known = '', inherited = ''] = directories;
    writeFakeTool({ directory: override, name: 'uvx-fake' }, { version: 'uv 1.2.3' });
    writeFakeTool({ directory: login, name: 'uvx-fake' });
    writeFakeTool({ directory: login, name: 'poetry-fake' });
    writeFakeTool({ directory: known, name: 'rv-fake' });
    writeFakeTool({ directory: inherited, name: 'cargo-fake' });
    let captures = 0;
    const finder = createToolchainFinder({
      home: tempDir,
      inheritedPath: inherited,
      captureEnvironment: async () => {
        captures += 1;
        await Promise.resolve();
        return ok({ PATH: login, MISE_DATA_DIR: '/m' });
      },
      toolPaths: () => {
        return new Map([['uvx-fake', override]]);
      },
      corepack: err('no node'),
      logger: logger.logger,
      wellKnown: [known],
    });
    const find = async (executable: string): Promise<readonly string[] | undefined> => {
      const found = await finder.find({ candidate: candidate(executable), cwd: tempDir, env: {} });
      return found?.command;
    };
    await expect(find('uvx-fake')).resolves.toStrictEqual([path.join(override, 'uvx-fake')]);
    await expect(find('poetry-fake')).resolves.toStrictEqual([path.join(login, 'poetry-fake')]);
    await expect(find('rv-fake')).resolves.toStrictEqual([path.join(known, 'rv-fake')]);
    await expect(find('cargo-fake')).resolves.toStrictEqual([path.join(inherited, 'cargo-fake')]);
    await expect(find('bun-fake')).resolves.toBeUndefined();
    await expect(
      finder.find({ candidate: candidate('uvx-fake'), cwd: tempDir, env: {} }),
    ).resolves.toMatchObject({
      version: 'uv 1.2.3',
      env: { PATH: [override, login, known, inherited].join(path.delimiter) },
    });
    await expect(finder.environment()).resolves.toStrictEqual({ MISE_DATA_DIR: '/m' });
    expect(captures).toBe(1);
  });

  test('runs Node package managers through corepack on beuve’s Node, unless Settings names one', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const node = writeFakeTool({ directory: tempDir, name: 'node' });
    const finder = createToolchainFinder({
      home: tempDir,
      inheritedPath: undefined,
      captureEnvironment: async () => {
        await Promise.resolve();
        return err('no shell');
      },
      toolPaths: () => {
        return new Map();
      },
      corepack: ok({ node: node.command, script: '/app/corepack/dist/corepack.js' }),
      logger: logger.logger,
      wellKnown: [],
    });
    await expect(
      finder.find({ candidate: candidate('pnpm', 'corepack'), cwd: tempDir, env: {} }),
    ).resolves.toMatchObject({
      command: [node.command, '/app/corepack/dist/corepack.js', 'pnpm'],
      env: { PATH: tempDir },
    });
    expect(node.calls().at(-1)?.argv).toStrictEqual([
      '/app/corepack/dist/corepack.js',
      'pnpm',
      '--version',
    ]);
    expect(node.calls().at(-1)?.cwd).toBe(tempDir);
    await expect(finder.searchPath()).resolves.toBe(tempDir);
    expect(logger.lines.some((line) => line['level'] === 'warn')).toBe(true);
  });
});

function candidate(executable: string, toolchain: ToolchainKind = 'host'): ToolCandidate {
  return {
    executable,
    toolchain,
    steps: (): readonly (readonly string[])[] => {
      return [['install']];
    },
    env: (): Readonly<Record<string, string>> => {
      return {};
    },
  };
}
