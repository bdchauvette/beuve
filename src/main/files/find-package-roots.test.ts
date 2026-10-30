import { describe } from 'vitest';

import { findPackageRoots } from './find-package-roots.ts';
import { test } from '../testing/test.ts';

describe('findPackageRoots', () => {
  test('finds directories holding a manifest, the root as the empty string', ({ expect }) => {
    expect(
      findPackageRoots([
        'package.json',
        'README.md',
        'packages/web/package.json',
        'packages/web/src/app.ts',
        'services/api/go.mod',
        'crates/core/Cargo.toml',
        'tools/lint/pyproject.toml',
        'docs/package.json.md',
        'apackage.json',
      ]),
    ).toStrictEqual(['', 'crates/core', 'packages/web', 'services/api', 'tools/lint']);
  });

  test('ignores vendored manifests', ({ expect }) => {
    expect(
      findPackageRoots(['node_modules/x/package.json', 'app/vendor/y/go.mod', 'app/go.mod']),
    ).toStrictEqual(['app']);
  });
});
