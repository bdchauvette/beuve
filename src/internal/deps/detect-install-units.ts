import path from 'node:path';

import type { DirectoryFacts, Ecosystem, EcosystemRow, ToolId } from './dependency-ecosystem.ts';
import { ecosystemRows } from './ecosystem-rows.ts';
import { joinPath } from './join-path.ts';
import { namesByDirectory } from './names-by-directory.ts';
import type { TreeEntry } from './tree-entry.ts';
import { workspacePatternsFrom } from './workspace-patterns-from.ts';

/** One install: a row of the table, in one directory of the checkout. */
export interface InstallUnit {
  readonly tool: ToolId;
  readonly ecosystem: Ecosystem;
  /** Repository-relative, `/`-separated; `''` is the top level. */
  readonly directory: string;
  /** The lockfile names that selected the row, in `directory`. */
  readonly lockfiles: readonly string[];
}

/** A Node lockfile left out because it lies inside another unit's workspace. */
export interface WorkspaceMember {
  readonly directory: string;
  readonly root: string;
}

/** Every unit to install, top level first, and the workspace members installed with a root. */
export interface DetectedUnits {
  readonly units: readonly InstallUnit[];
  readonly members: readonly WorkspaceMember[];
}

/** The tree and the text of the files `detectionReadsFrom` asked for, by path. */
export interface DetectionInput {
  readonly entries: readonly TreeEntry[];
  readonly contents: ReadonlyMap<string, string>;
}

const leadingDot = /^\.\//u;
const trailingSlashes = /\/+$/u;

/**
 * Finds what to install from the reviewed commit's tree (ADR 0089): for each directory, the
 * first row of each ecosystem in {@link ecosystemRows} whose lockfile is there (and whose own
 * condition holds). A Node unit inside another Node unit's workspaces (`workspaces` in
 * `package.json`, `packages` in `pnpm-workspace.yaml`) is a member, installed once with its
 * root. Links, and anything under `node_modules`, `vendor`, `.venv` or `target`, are never
 * lockfiles. Pure: the caller reads the manifests {@link detectionReadsFrom} names.
 */
export function detectInstallUnits({ entries, contents }: DetectionInput): DetectedUnits {
  const directories = namesByDirectory(entries);
  const found: InstallUnit[] = [];
  for (const [directory, names] of directories) {
    const facts: DirectoryFacts = {
      names,
      packageManager: packageManagerIn(contents.get(joinPath({ directory, name: 'package.json' }))),
    };
    const claimed = new Set<Ecosystem>();
    for (const row of ecosystemRows) {
      if (claimed.has(row.ecosystem)) {
        continue;
      }
      const lockfiles = [...names]
        .filter((name) => isLockfileOf(row, name))
        .toSorted((left, right) => left.localeCompare(right));
      if (lockfiles.length === 0 || row.when?.(facts) === false) {
        continue;
      }
      claimed.add(row.ecosystem);
      found.push({ tool: row.tool, ecosystem: row.ecosystem, directory, lockfiles });
    }
  }
  const ordered = found.toSorted(byDepthThenPath);
  return withoutMembers(ordered, contents);
}

function isLockfileOf(row: EcosystemRow, name: string): boolean {
  return row.lockfiles.some((pattern) => {
    if (typeof pattern === 'string') {
      return pattern === name;
    }
    return pattern.test(name);
  });
}

function packageManagerIn(manifest: string | undefined): string | undefined {
  if (manifest === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const value = (parsed as Record<string, unknown>)['packageManager'];
    if (typeof value === 'string') {
      return value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Drops Node units that lie inside an earlier (shallower) Node unit's workspaces. */
function withoutMembers(
  units: readonly InstallUnit[],
  contents: ReadonlyMap<string, string>,
): DetectedUnits {
  const kept: InstallUnit[] = [];
  const members: WorkspaceMember[] = [];
  for (const unit of units) {
    let root: InstallUnit | undefined;
    if (unit.ecosystem === 'node') {
      root = workspaceRootOf(unit, { kept, contents });
    }
    if (root === undefined) {
      kept.push(unit);
    } else {
      members.push({ directory: unit.directory, root: root.directory });
    }
  }
  return { units: kept, members };
}

/** The units kept so far, and the manifests' text. */
interface WorkspaceSearch {
  readonly kept: readonly InstallUnit[];
  readonly contents: ReadonlyMap<string, string>;
}

function workspaceRootOf(
  unit: InstallUnit,
  { kept, contents }: WorkspaceSearch,
): InstallUnit | undefined {
  return kept.find((candidate) => {
    if (candidate.ecosystem !== 'node' || !isBelow({ ancestor: candidate.directory, unit })) {
      return false;
    }
    const patterns = workspacePatternsFrom({
      packageJson: contents.get(joinPath({ directory: candidate.directory, name: 'package.json' })),
      pnpmWorkspace: contents.get(
        joinPath({ directory: candidate.directory, name: 'pnpm-workspace.yaml' }),
      ),
    });
    const relative = path.posix.relative(candidate.directory, unit.directory);
    let isMember = false;
    for (const pattern of patterns) {
      if (pattern.startsWith('!')) {
        if (path.posix.matchesGlob(relative, normalisedPattern(pattern.slice(1)))) {
          isMember = false;
        }
      } else if (path.posix.matchesGlob(relative, normalisedPattern(pattern))) {
        isMember = true;
      }
    }
    return isMember;
  });
}

/** A directory, and the unit that may lie below it. */
interface Below {
  readonly ancestor: string;
  readonly unit: InstallUnit;
}

function isBelow({ ancestor, unit }: Below): boolean {
  if (ancestor === unit.directory) {
    return false;
  }
  return ancestor === '' || unit.directory.startsWith(`${ancestor}/`);
}

function normalisedPattern(pattern: string): string {
  return pattern.replace(leadingDot, '').replace(trailingSlashes, '');
}

function byDepthThenPath(left: InstallUnit, right: InstallUnit): number {
  const depth = (unit: InstallUnit): number => {
    if (unit.directory === '') {
      return 0;
    }
    return unit.directory.split('/').length;
  };
  return depth(left) - depth(right) || left.directory.localeCompare(right.directory);
}
