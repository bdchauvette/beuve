import { describe } from 'vitest';

import { dependencyInputsIn } from './dependency-inputs-in.ts';
import { test } from './testing/test.ts';

describe('dependencyInputsIn (ADR 0090)', () => {
  test('names lockfiles, manifests, package-manager configuration, toolchain pins and .beuve', ({
    expect,
  }) => {
    expect(
      dependencyInputsIn([
        'src/index.ts',
        'package-lock.json',
        'web/package.json',
        'web/.npmrc',
        '.yarnrc.yml',
        'tools/pnpm-workspace.yaml',
        'py/uv.toml',
        'poetry.toml',
        'rb/.bundle/config',
        'rb/app.gemspec',
        'requirements-dev.txt',
        'composer.json',
        'go.mod',
        'Cargo.toml',
        '.nvmrc',
        '.beuve/config.json',
        '.beuve/hooks/install',
        'docs/package.md',
        'node_modules/x/package.json',
        'vendor/y/composer.lock',
        'web/package-lock.json',
        'web/package-lock.json',
      ]),
    ).toStrictEqual([
      '.beuve/config.json',
      '.beuve/hooks/install',
      '.nvmrc',
      '.yarnrc.yml',
      'Cargo.toml',
      'composer.json',
      'go.mod',
      'package-lock.json',
      'poetry.toml',
      'py/uv.toml',
      'rb/.bundle/config',
      'rb/app.gemspec',
      'requirements-dev.txt',
      'tools/pnpm-workspace.yaml',
      'web/.npmrc',
      'web/package-lock.json',
      'web/package.json',
    ]);
  });

  test('a change that touches no dependency input names none', ({ expect }) => {
    expect(dependencyInputsIn(['src/a.ts', 'README.md', 'config.json'])).toStrictEqual([]);
  });
});
