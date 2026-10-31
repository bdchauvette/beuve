import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { TestRepository } from './test-repository.ts';

/** A line to rewrite: `line` (1-based) of `file`, and its new content. */
export interface LineEdit {
  readonly file: string;
  readonly line: number;
  readonly content: string;
}

/** Rewrites line `line` (1-based) of `file` in `repo`'s worktree. */
export function setLine(repo: TestRepository, { file, line, content }: LineEdit): void {
  const current = readFileSync(path.join(repo.directory, file), 'utf8').split('\n');
  repo.write(file, current.with(line - 1, content).join('\n'));
}
