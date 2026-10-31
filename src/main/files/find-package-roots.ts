const manifestNames = new Set(['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml']);

/**
 * The directories among `paths` that hold a package manifest (`package.json`, `go.mod`,
 * `Cargo.toml`, `pyproject.toml`), sorted, the repository root as `''`. Manifests under
 * `node_modules` or `vendor` directories don't count: they are dependencies, not packages.
 */
export function findPackageRoots(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    if (!manifestNames.has(path.slice(slash + 1))) {
      continue;
    }
    let directory = '';
    if (slash !== -1) {
      directory = path.slice(0, slash);
    }
    if (!isVendored(directory)) {
      roots.add(directory);
    }
  }
  return [...roots].toSorted((a, b) => a.localeCompare(b));
}

function isVendored(directory: string): boolean {
  return directory.split('/').some((part) => part === 'node_modules' || part === 'vendor');
}
