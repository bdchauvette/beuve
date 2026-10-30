import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { linkTestVitest } from './link-test-vitest.ts';

/** A throwaway Vitest project for runner integration tests. */
export interface VitestFixture {
  /** The project, laid out like a beuve worktree: no `node_modules` (real path). */
  readonly worktree: string;
  /** A sibling directory whose `node_modules/vitest` links to beuve's own Vitest. */
  readonly dependencyRoot: string;
  /** Where runners may put their temporary directories. */
  readonly temporaryDirectory: string;
  readonly write: (file: string, content: string) => void;
  readonly cleanup: () => void;
}

/**
 * Creates the fixture in a new directory under `parent` (the system temporary directory by
 * default), with `files` relative to the worktree.
 */
export function createVitestFixture(
  files: Readonly<Record<string, string>>,
  parent: string = os.tmpdir(),
): VitestFixture {
  const created = mkdtempSync(path.join(parent, 'beuve-trace-'));
  const base = realpathSync(created);
  const worktree = path.join(base, 'worktree');
  const dependencyRoot = path.join(base, 'dependencies');
  const temporaryDirectory = path.join(base, 'tmp');
  linkTestVitest(dependencyRoot);
  const write = (file: string, content: string): void => {
    const target = path.join(worktree, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write('package.json', JSON.stringify({ name: 'fixture', type: 'module', private: true }));
  write(
    'vitest.config.ts',
    "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { include: ['src/**/*.test.ts'] } });\n",
  );
  for (const [file, content] of Object.entries(files)) {
    write(file, content);
  }
  return {
    worktree,
    dependencyRoot,
    temporaryDirectory,
    write,
    cleanup: (): void => {
      rmSync(base, { recursive: true, force: true });
    },
  };
}
