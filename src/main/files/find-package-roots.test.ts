import { describe, expect, it } from 'vitest';

import { findPackageRoots } from './find-package-roots.ts';

describe('findPackageRoots', () => {
  it('finds directories holding a manifest, the root as the empty string', () => {
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
    ).toEqual(['', 'crates/core', 'packages/web', 'services/api', 'tools/lint']);
  });

  it('ignores vendored manifests', () => {
    expect(
      findPackageRoots(['node_modules/x/package.json', 'app/vendor/y/go.mod', 'app/go.mod']),
    ).toEqual(['app']);
  });
});
