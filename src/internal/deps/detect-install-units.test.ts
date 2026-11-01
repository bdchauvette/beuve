import { describe } from 'vitest';

import { detectInstallUnits } from './detect-install-units.ts';
import { detectionReadsFrom } from './detection-reads-from.ts';
import { test } from './testing/test.ts';
import type { TreeEntry } from './tree-entry.ts';

describe('detectInstallUnits (ADR 0089)', () => {
  test('finds one unit per ecosystem and directory across a polyglot repository', ({ expect }) => {
    const entries = tree([
      'package.json',
      'pnpm-lock.yaml',
      'package-lock.json',
      'py/pyproject.toml',
      'py/uv.lock',
      'poetry/pyproject.toml',
      'poetry/poetry.lock',
      'reqs/requirements.txt',
      'reqs/requirements-dev.txt',
      'php/composer.json',
      'php/composer.lock',
      'rb/Gemfile',
      'rb/Gemfile.lock',
      'go/go.mod',
      'go/go.sum',
      'go-orphan/go.sum',
      'rs/Cargo.toml',
      'rs/Cargo.lock',
      'berry/package.json',
      'berry/.yarnrc.yml',
      'berry/yarn.lock',
      'classic/package.json',
      'classic/yarn.lock',
      'bun/package.json',
      'bun/bun.lock',
      'node_modules/dep/package-lock.json',
      'vendor/x/composer.lock',
    ]);
    const detected = detectInstallUnits({ entries, contents: new Map() });
    expect(
      detected.units.map((unit) => {
        return [unit.directory, unit.tool, unit.lockfiles];
      }),
    ).toStrictEqual([
      ['', 'pnpm', ['pnpm-lock.yaml']],
      ['berry', 'yarn-berry', ['yarn.lock']],
      ['bun', 'bun', ['bun.lock']],
      ['classic', 'yarn-classic', ['yarn.lock']],
      ['go', 'go', ['go.sum']],
      ['php', 'composer', ['composer.lock']],
      ['poetry', 'poetry', ['poetry.lock']],
      ['py', 'uv', ['uv.lock']],
      ['rb', 'bundler', ['Gemfile.lock']],
      ['reqs', 'pip', ['requirements-dev.txt', 'requirements.txt']],
      ['rs', 'cargo', ['Cargo.lock']],
    ]);
    expect(detected.members).toStrictEqual([]);
  });

  test('installs a workspace once at its root, honouring exclusions and nested roots', ({
    expect,
  }) => {
    const entries = tree([
      'package.json',
      'package-lock.json',
      'apps/web/package.json',
      'apps/web/package-lock.json',
      'apps/excluded/package-lock.json',
      'tools/pnpm/pnpm-workspace.yaml',
      'tools/pnpm/pnpm-lock.yaml',
      'tools/pnpm/packages/a/pnpm-lock.yaml',
      'tools/pnpm/other/pnpm-lock.yaml',
      'apps/web/py/uv.lock',
    ]);
    const contents = new Map([
      [
        'package.json',
        JSON.stringify({ workspaces: { packages: ['./apps/*', '!apps/excluded'] } }),
      ],
      [
        'tools/pnpm/pnpm-workspace.yaml',
        '# monorepo\npackages:\n  - \'packages/*\' # all of them\n  - "!packages/skip"\ncatalog:\n  zod: 1\n',
      ],
    ]);
    const detected = detectInstallUnits({ entries, contents });
    expect(
      detected.units.map((unit) => {
        return [unit.directory, unit.tool];
      }),
    ).toStrictEqual([
      ['', 'npm'],
      ['apps/excluded', 'npm'],
      ['tools/pnpm', 'pnpm'],
      ['apps/web/py', 'uv'],
      ['tools/pnpm/other', 'pnpm'],
    ]);
    expect(detected.members).toStrictEqual([
      { directory: 'apps/web', root: '' },
      { directory: 'tools/pnpm/packages/a', root: 'tools/pnpm' },
    ]);
  });

  test('`packageManager` naming yarn 2 or later means berry; a link is never a lockfile', ({
    expect,
  }) => {
    const entries = [
      ...tree(['package.json', 'yarn.lock']),
      { path: 'linked/package-lock.json', mode: '120000' },
    ];
    const contents = new Map([['package.json', JSON.stringify({ packageManager: 'yarn@4.9.2' })]]);
    expect(detectInstallUnits({ entries, contents }).units).toStrictEqual([
      { tool: 'yarn-berry', ecosystem: 'node', directory: '', lockfiles: ['yarn.lock'] },
    ]);
  });

  test('reads only the manifests of directories with a Node lockfile', ({ expect }) => {
    const entries = tree([
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'lib/package.json',
      'app/package.json',
      'app/yarn.lock',
      'py/pyproject.toml',
      'py/uv.lock',
    ]);
    expect(detectionReadsFrom(entries)).toStrictEqual([
      'package.json',
      'pnpm-workspace.yaml',
      'app/package.json',
    ]);
  });
});

function tree(paths: readonly string[]): readonly TreeEntry[] {
  return paths.map((file) => {
    return { path: file, mode: '100644' };
  });
}
