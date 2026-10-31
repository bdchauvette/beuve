import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { isObjectId } from './is-object-id.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A fixed-string search of one commit's tree. */
export interface TreeGrepQuery {
  /** Matched literally (`-F`), never as a regular expression. */
  readonly pattern: string;
  /** ASCII case folding (`-i` in the C locale). */
  readonly ignoreCase: boolean;
  /** Only files under this repository-relative path (literal pathspec); the whole tree if absent. */
  readonly scope?: string;
  /** Only matches in files it accepts count; others are skipped without counting. */
  readonly accept?: (path: string) => boolean;
  readonly maxMatches: number;
  /** Each match's text is cut to this many characters. */
  readonly maxLineChars: number;
  readonly signal?: AbortSignal | undefined;
}

export interface TreeGrepMatch {
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  readonly text: string;
}

export interface TreeGrepResult {
  readonly matches: readonly TreeGrepMatch[];
  /** More matches existed than `maxMatches`. */
  readonly isCapped: boolean;
}

/**
 * The lines of `commit`'s tracked text files that contain `query.pattern`, with `git grep -F`
 * on the commit's tree (never the working tree or the index), streamed and stopped with SIGTERM
 * once one match more than `maxMatches` arrives. Binary files are skipped (`-I`), textconv and
 * submodules too, and repository config can't change the output's shape (`--no-column`,
 * `--no-color`). Paths come from `-z` output, so they are never quoted. A pattern holding a
 * newline matches nothing. `commit` must be a full SHA: `git grep` has no `--end-of-options`.
 */
export async function grepTree(
  repository: GitRepository,
  commit: CommitSha,
  query: TreeGrepQuery,
): Promise<Result<TreeGrepResult, GitError>> {
  if (!isObjectId(commit)) {
    return err({ kind: 'invalid-argument', argument: commit, reason: 'not a full commit sha' });
  }
  if (query.pattern.includes('\n') || query.pattern.length === 0) {
    return ok({ matches: [], isCapped: false });
  }
  const args = [
    'grep',
    '-z',
    '-n',
    '-I',
    '-F',
    '--no-color',
    '--no-column',
    '--no-textconv',
    '--no-recurse-submodules',
    ...(query.ignoreCase ? ['-i'] : []),
    '-e',
    query.pattern,
    commit,
    '--',
    ...(query.scope === undefined ? [] : [query.scope]),
  ];
  const parser = new GrepOutputParser(`${commit}:`, query);
  const streamed = await repository[gitRunner].stream(args, {
    policy: { kind: 'read' },
    signal: query.signal,
    onStdout: (chunk) => {
      return parser.push(chunk);
    },
  });
  if (!streamed.ok) {
    const { error } = streamed;
    if (error.kind === 'command-failed' && error.exitCode === 1 && error.stderr === '') {
      return ok({ matches: [], isCapped: false });
    }
    return streamed;
  }
  return ok({ matches: parser.matches, isCapped: parser.isCapped });
}

/**
 * Reads `<commit>:<path> NUL <line> NUL <text> LF` records as they stream. A path may hold a
 * newline (it ends at its NUL) and text never does; text past the cut is dropped as it arrives.
 */
class GrepOutputParser {
  readonly #prefix: string;
  readonly #query: TreeGrepQuery;
  #field: 0 | 1 | 2 = 0;
  #parts: Buffer[] = [];
  #kept = 0;
  #path = '';
  #line = 0;
  readonly matches: TreeGrepMatch[] = [];
  isCapped = false;

  constructor(prefix: string, query: TreeGrepQuery) {
    this.#prefix = prefix;
    this.#query = query;
  }

  #keep(part: Buffer): void {
    const room = this.#field === 2 ? this.#query.maxLineChars * 4 - this.#kept : part.length;
    if (room <= 0) {
      return;
    }
    const kept = part.subarray(0, room);
    this.#parts.push(kept);
    this.#kept += kept.length;
  }

  #endField(): 'more' | 'stop' {
    const text = Buffer.concat(this.#parts).toString('utf8');
    this.#parts = [];
    this.#kept = 0;
    switch (this.#field) {
      case 0: {
        this.#path = text.startsWith(this.#prefix) ? text.slice(this.#prefix.length) : text;
        this.#field = 1;
        return 'more';
      }
      case 1: {
        this.#line = Number(text);
        this.#field = 2;
        return 'more';
      }
      case 2: {
        this.#field = 0;
        return this.#match(text);
      }
    }
  }

  #match(text: string): 'more' | 'stop' {
    if (this.#query.accept !== undefined && !this.#query.accept(this.#path)) {
      return 'more';
    }
    if (this.matches.length === this.#query.maxMatches) {
      this.isCapped = true;
      return 'stop';
    }
    this.matches.push({
      path: this.#path,
      line: this.#line,
      text: text.slice(0, this.#query.maxLineChars),
    });
    return 'more';
  }

  push(chunk: Buffer): 'more' | 'stop' {
    let offset = 0;
    while (offset < chunk.length) {
      const terminator = this.#field === 2 ? 0x0a : 0;
      const end = chunk.indexOf(terminator, offset);
      const stop = end === -1 ? chunk.length : end;
      this.#keep(chunk.subarray(offset, stop));
      if (end === -1) {
        return 'more';
      }
      offset = end + 1;
      if (this.#endField() === 'stop') {
        return 'stop';
      }
    }
    return 'more';
  }
}
