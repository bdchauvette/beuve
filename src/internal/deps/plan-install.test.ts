import { describe } from 'vitest';

import type { ToolId } from './dependency-ecosystem.ts';
import type { InstallUnit } from './detect-install-units.ts';
import { planInstall } from './plan-install.ts';
import type { ResolvedTool } from './plan-install.ts';
import { test } from './testing/test.ts';

describe('planInstall (ADR 0089, 0092)', () => {
  test('orders detected installs, then configured steps, then the hook', ({ expect }) => {
    const planned = planInstall({
      units: [unit('pnpm', ''), unit('uv', 'py'), unit('cargo', 'rs')],
      config: {
        skip: ['rust'],
        steps: [{ run: ['make', 'gen'], cwd: 'tools', env: { MODE: 'ci' } }],
      },
      hook: '/co/.beuve/hooks/install',
      tools: new Map<ToolId, ResolvedTool>([
        ['pnpm', tool('pnpm', ['/node', '/corepack.js', 'pnpm'])],
        ['uv', tool('uv', ['/bin/uv'])],
      ]),
      cacheRoot: '/cache',
      env: { HOME: '/home/me' },
    });
    expect(planned).toStrictEqual({
      ok: true,
      value: {
        steps: [
          {
            label: 'pnpm in the top level',
            cwd: '',
            argv: [
              '/node',
              '/corepack.js',
              'pnpm',
              'install',
              '--frozen-lockfile',
              '--store-dir',
              '/cache/pnpm-store',
            ],
            env: { HOME: '/home/me', PATH: '/tools' },
          },
          {
            label: 'uv in py/',
            cwd: 'py',
            argv: ['/bin/uv', 'sync', '--frozen'],
            env: { HOME: '/home/me', PATH: '/tools', UV_CACHE_DIR: '/cache/uv' },
          },
          {
            label: '.beuve step: make gen',
            cwd: 'tools',
            argv: ['make', 'gen'],
            env: { HOME: '/home/me', MODE: 'ci' },
          },
          {
            label: '.beuve/hooks/install',
            cwd: '',
            argv: ['/co/.beuve/hooks/install'],
            env: { HOME: '/home/me' },
          },
        ],
        tools: [
          { tool: 'pnpm', version: '1.0.0' },
          { tool: 'uv', version: '1.0.0' },
        ],
      },
    });
  });

  test('an `instead` hook replaces the detected installs', ({ expect }) => {
    const planned = planInstall({
      units: [unit('npm', '')],
      config: { hook: 'instead' },
      hook: '/co/.beuve/hooks/install',
      tools: new Map(),
      cacheRoot: '/cache',
      env: {},
    });
    expect(planned).toMatchObject({ ok: true, value: { steps: [{ cwd: '', env: {} }] } });
  });

  test('refuses with every missing tool and how to get it, installing nothing', ({ expect }) => {
    const planned = planInstall({
      units: [unit('bun', ''), unit('bundler', 'rb'), unit('bundler', 'rb2')],
      config: {},
      hook: undefined,
      tools: new Map(),
      cacheRoot: '/cache',
      env: {},
    });
    expect(planned).toMatchObject({
      ok: false,
      error: [
        { tool: 'bun', executables: ['bun'], fix: expect.stringContaining('bun.sh') as unknown },
        { tool: 'bundler', executables: ['rv', 'bundle'] },
      ],
    });
  });

  test('bundler uses rv when that is the executable found', ({ expect }) => {
    const planned = planInstall({
      units: [unit('bundler', '')],
      config: {},
      hook: undefined,
      tools: new Map([['bundler', tool('rv', ['/bin/rv'])]]),
      cacheRoot: '/cache',
      env: {},
    });
    expect(planned).toMatchObject({
      ok: true,
      value: { steps: [{ argv: ['/bin/rv', 'ci'], env: { BUNDLE_FROZEN: 'true' } }] },
    });
  });
});

function unit(tool: ToolId, directory: string): InstallUnit {
  const ecosystems = {
    pnpm: 'node',
    npm: 'node',
    bun: 'node',
    uv: 'python',
    cargo: 'rust',
    bundler: 'ruby',
  } as const;
  const ecosystem = ecosystems[tool as keyof typeof ecosystems];
  return { tool, ecosystem, directory, lockfiles: ['lock'] };
}

function tool(executable: string, command: readonly string[]): ResolvedTool {
  return { executable, command, version: '1.0.0', env: { PATH: '/tools' } };
}
