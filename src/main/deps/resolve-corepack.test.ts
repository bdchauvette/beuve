import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';

import packageJson from '../../../package.json' with { type: 'json' };
import { test } from '../testing/test.ts';
import { resolveCorepack } from './resolve-corepack.ts';

describe('resolveCorepack (ADR 0091)', () => {
  test('finds the pinned corepack, which the resolved Node runs', async ({
    expect,
    nodeRuntime,
    signal,
  }) => {
    const corepack = okValueFrom(resolveCorepack(nodeRuntime));
    expect(corepack.script).toMatch(/corepack[/\\]dist[/\\]corepack\.js$/u);
    const { stdout } = await promisify(execFile)(corepack.node, [corepack.script, '--version'], {
      encoding: 'utf8',
      signal,
    });
    expect(stdout.trim()).toBe(packageJson.dependencies.corepack);
  });

  test('without a Node, says why', ({ expect }) => {
    expect(
      resolveCorepack(err({ kind: 'missing', source: 'path', searched: ['/usr/bin/node'] })),
    ).toMatchObject({ ok: false });
  });
});
