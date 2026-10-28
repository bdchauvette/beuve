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
    .map((file) => ({ path: file, reason: 'name' as const, distance: 0 }));
  const imported = tests
    .filter((file) => distances.has(file) && stemOf(file) !== stem)
    .map((file) => {
      const distance = distances.get(file) ?? 0;
      return {
        path: file,
        reason: distance === 1 ? ('imports' as const) : ('transitive' as const),
        distance,
      };
    });
  const directory = path.posix.dirname(changedPath);
  const nameRank = (file: string): number =>
    (distances.get(file) === 1 ? 0 : 2) + (closeness(directory, file) > 0 ? 0 : 1);
  const byName = named.toSorted(
    (left, right) =>
      nameRank(left.path) - nameRank(right.path) ||
      closeness(directory, right.path) - closeness(directory, left.path) ||
      left.path.localeCompare(right.path),
  );
  const byImports = imported.toSorted(
    (left, right) => left.distance - right.distance || left.path.localeCompare(right.path),
  );
  return [...byName, ...byImports].slice(0, maxFiles);
}

function stemOf(file: string): string {
  return path.posix.basename(file).replace(stemPattern, '');
}

/** How much of `directory` the test's directory shares, in segments; a `__tests__` child counts. */
function closeness(directory: string, file: string): number {
  const own = path.posix.dirname(file).replace(testsDirectoryPattern, '') || '.';
  if (own === directory) {
    return Number.MAX_SAFE_INTEGER;
  }
  const left = directory.split('/');
  const right = own.split('/');
  let shared = 0;
  while (shared < left.length && left[shared] === right[shared]) {
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
      const list = importers.get(target) ?? [];
      list.push(file);
      importers.set(target, list);
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
