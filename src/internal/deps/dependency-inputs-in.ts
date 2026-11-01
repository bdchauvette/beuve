import path from 'node:path';

import { ecosystemRows } from './ecosystem-rows.ts';
import { isIgnoredDependencyPath } from './is-ignored-dependency-path.ts';

/** Toolchain pins every ecosystem reads: they choose which tool, or which version, runs. */
const toolchainFiles = new Set([
  '.tool-versions',
  'mise.toml',
  '.mise.toml',
  '.nvmrc',
  '.node-version',
]);

/**
 * Which of `paths` (repository-relative, as a diff names them) are dependency inputs, for the
 * lockfile safeguard (ADR 0090): any lockfile, manifest or package-manager configuration file
 * of the detection table (`.npmrc`, `.yarnrc.yml`, `pnpm-workspace.yaml`, `bunfig.toml`,
 * `uv.toml`, `poetry.toml`, `.bundle/config`, …), the toolchain pins, and anything under
 * `.beuve/`, beuve's own install configuration and hooks (ADR 0092). A whole manifest counts,
 * not only its dependency and script sections: the simple, conservative choice. Paths under
 * `node_modules`, `vendor`, `.venv` and `target` don't. Sorted, without duplicates.
 */
export function dependencyInputsIn(paths: readonly string[]): readonly string[] {
  const inputs = new Set<string>();
  for (const file of paths) {
    if (isDependencyInput(file)) {
      inputs.add(file);
    }
  }
  return [...inputs].toSorted((left, right) => left.localeCompare(right));
}

function isDependencyInput(file: string): boolean {
  if (file === '.beuve' || file.startsWith('.beuve/')) {
    return true;
  }
  if (isIgnoredDependencyPath(file)) {
    return false;
  }
  const name = path.posix.basename(file);
  if (toolchainFiles.has(name)) {
    return true;
  }
  return ecosystemRows.some((row) => {
    const isNamed = [...row.lockfiles, ...row.manifests].some((pattern) => {
      if (typeof pattern === 'string') {
        return pattern === name;
      }
      return pattern.test(name);
    });
    return isNamed || row.config.some((config) => file === config || file.endsWith(`/${config}`));
  });
}
