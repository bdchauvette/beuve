import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { TestRepository } from './test-repository.ts';

/** Rewrites line `line` (1-based) of `file` in `repo`'s worktree. */
export function setLine(repo: TestRepository, file: string, line: number, content: string): void {
  const current = readFileSync(path.join(repo.directory, file), 'utf8').split('\n');
  repo.write(file, current.with(line - 1, content).join('\n'));
}
