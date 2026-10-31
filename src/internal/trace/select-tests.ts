import path from 'node:path';

import { isTestFile } from './is-test-file.ts';

/** Why a test file was picked; `distance` is import hops from the changed file (0 for names). */
export interface TestSelection {
  readonly path: string;
  readonly reason: 'self' | 'name' | 'imports' | 'transitive';
  readonly distance: number;
}

export interface SelectTestsInput {
  /** Repository-relative POSIX path of the file the hunk is in. */
  readonly changedPath: string;
  /** Every repository-relative file (`git ls-files` at the head). */
  readonly files: readonly string[];
  /** Repository-relative imports per file, e.g. from `buildImportGraph`. May be partial. */
  readonly imports: ReadonlyMap<string, readonly string[]>;
  /** Defaults to 3. */
  readonly maxFiles?: number;
  /** Import hops followed backwards from the changed file. Defaults to 4. */
  readonly maxDepth?: number;
}

const testsDirectoryPattern = /(?:^|\/)__tests__$/u;
const stemPattern = /(?:\.(?:test|spec))?\.[cm]?[jt]sx?$/u;

/**
 * Picks the test files most likely to cover a change (ADR 0036): the file itself when it is a
 * test; then tests named after it (`foo.ts` → `foo.test.ts`, `foo.spec.tsx`, `__tests__/foo.ts`),
 * nearest directory first, ranked ahead when they also import it; then tests importing it
 * directly; then tests reaching it through other modules, fewest hops first.
 */
export function selectTests(input: SelectTestsInput): TestSelection[] {
  const { changedPath } = input;
  if (isTestFile(changedPath)) {
    return [{ path: changedPath, reason: 'self', distance: 0 }];
  }
  const maxFiles = input.maxFiles ?? 3;
  const tests = input.files.filter((file) => isTestFile(file) && file !== changedPath);
  const distances = importDistances(changedPath, input.imports, input.maxDepth ?? 4);
  const stem = stemOf(changedPath);
  const named = tests
    .filter((file) => stemOf(file) === stem)
    .map((file) => {
      return { path: file, reason: 'name' as const, distance: 0 };
    });
  const imported = tests
    .filter((file) => distances.has(file) && stemOf(file) !== stem)
    .map((file) => {
      const distance = distances.get(file) ?? 0;
      if (distance === 1) {
        return { path: file, reason: 'imports' as const, distance };
      }
      return { path: file, reason: 'transitive' as const, distance };
    });
  const directory = path.posix.dirname(changedPath);
  const closenessOf = (file: string): number => {
    return sharedSegments(directory, testDirectoryOf(file));
  };
  /** Imported directly first, then those near the change. */
  const nameRank = (file: string): number => {
    let rank = 0;
    if (distances.get(file) !== 1) {
      rank += 2;
    }
    if (closenessOf(file) === 0) {
      rank += 1;
    }
    return rank;
  };
  const byName = named.toSorted((left, right) => {
    return (
      nameRank(left.path) - nameRank(right.path) ||
      closenessOf(right.path) - closenessOf(left.path) ||
      left.path.localeCompare(right.path)
    );
  });
  const byImports = imported.toSorted((left, right) => {
    return left.distance - right.distance || left.path.localeCompare(right.path);
  });
  return [...byName, ...byImports].slice(0, maxFiles);
}

function stemOf(file: string): string {
  return path.posix.basename(file).replace(stemPattern, '');
}

/** The directory a test belongs to: its own, or the parent of a `__tests__` directory. */
function testDirectoryOf(file: string): string {
  return path.posix.dirname(file).replace(testsDirectoryPattern, '') || '.';
}

/** How many leading segments two directories share; all of them when they are the same. */
function sharedSegments(left: string, right: string): number {
  if (left === right) {
    return Number.MAX_SAFE_INTEGER;
  }
  const leftSegments = left.split('/');
  const rightSegments = right.split('/');
  let shared = 0;
  while (shared < leftSegments.length && leftSegments[shared] === rightSegments[shared]) {
    shared += 1;
  }
  return shared;
}

function importDistances(
  changedPath: string,
  imports: ReadonlyMap<string, readonly string[]>,
  maxDepth: number,
): Map<string, number> {
  const importers = new Map<string, string[]>();
  for (const [file, targets] of imports) {
    for (const target of targets) {
      importers
        .getOrInsertComputed(target, () => {
          return [];
        })
        .push(file);
    }
  }
  const distances = new Map<string, number>([[changedPath, 0]]);
  let frontier = [changedPath];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      const direct = importers.get(file) ?? [];
      for (const importer of direct) {
        if (distances.has(importer)) {
          continue;
        }

        distances.set(importer, depth);
        next.push(importer);
      }
    }
    frontier = next;
  }
  distances.delete(changedPath);
  return distances;
}
