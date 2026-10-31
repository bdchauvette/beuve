import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { DiffFile } from './diff-model.ts';
import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';
import { parseUnifiedDiff } from './parse-unified-diff.ts';
import type { ReviewRange } from './review-range.ts';

/** One non-merge commit of a range, with its own change as a zero-context diff. */
export interface RangeCommit {
  readonly sha: CommitSha;
  /** Its first parent: the diff below is `parent` → `sha`. */
  readonly parent: CommitSha;
  readonly subject: string;
  /** `git patch-id --stable` of the change; `undefined` for an empty commit. */
  readonly patchId: string | undefined;
  /** The change with `--unified=0`, so hunks hold only changed lines. */
  readonly files: readonly DiffFile[];
}

export interface RangeCommits {
  /** Oldest first. */
  readonly commits: readonly RangeCommit[];
  /** The range had more than `maxCommits` commits; only the newest are listed. */
  readonly truncated: boolean;
}

export interface ListRangeCommitsOptions {
  /** Defaults to 100. */
  readonly maxCommits?: number;
}

const defaultMaxCommits = 100;
const headerPattern = /^commit ([0-9a-f]{40}|[0-9a-f]{64})$/u;
const indent = ' '.repeat(4);

/**
 * The commits on `head` since `base` (`base..head`, merges skipped), each with its zero-context
 * patch and stable patch-id: two git spawns, `log -p` and `patch-id` fed the same output, so the
 * ids describe exactly the patches returned.
 */
export async function listRangeCommits(
  repository: GitRepository,
  range: ReviewRange,
  options: ListRangeCommitsOptions = {},
): Promise<Result<RangeCommits, GitError>> {
  const maxCommits = options.maxCommits ?? defaultMaxCommits;
  const args = [
    'log',
    '--no-merges',
    '--reverse',
    `--max-count=${String(maxCommits + 1)}`,
    '--no-color',
    '--no-show-signature',
    '--no-notes',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--full-index',
    '--find-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '--unified=0',
    '--patch',
    `--format=commit %H%n${indent}%P%n${indent}%s`,
    '--end-of-options',
    range.head,
    `^${range.base}`,
    '--',
  ];
  const log = await repository[gitRunner].run(args, { policy: { kind: 'read' } });
  if (!log.ok) {
    return log;
  }
  if (log.value === '') {
    return ok({ commits: [], truncated: false });
  }
  const patchIds = await repository[gitRunner].exec(['patch-id', '--stable'], {
    policy: { kind: 'read' },
    input: log.value,
  });
  if (!patchIds.ok) {
    return patchIds;
  }
  const parsed = parseLog(args, log.value, parsePatchIds(patchIds.value.toString('utf8')));
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.length > maxCommits) {
    return ok({ commits: parsed.value.slice(1), truncated: true });
  }
  return ok({ commits: parsed.value, truncated: false });
}

function parsePatchIds(output: string): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  for (const line of output.split('\n')) {
    const [patchId, commit] = line.split(' ', 2);
    if (patchId !== undefined && commit !== undefined && patchId !== '') {
      ids.set(commit, patchId);
    }
  }
  return ids;
}

/** Splits `commit <sha>` / parents / subject headers from the patches that follow them. */
function parseLog(
  args: readonly string[],
  output: string,
  patchIds: ReadonlyMap<string, string>,
): Result<RangeCommit[], GitError> {
  const lines = output.split('\n');
  const commits: RangeCommit[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = headerPattern.exec(lines[index] ?? '');
    if (header === null) {
      if ((lines[index] ?? '') === '') {
        index += 1;
        continue;
      }
      return unexpected(args, `expected a commit header, got: ${lines[index] ?? ''}`);
    }
    const sha = header[1] as CommitSha;
    const parent = parseCommitSha(
      (lines[index + 1] ?? '').slice(indent.length).split(' ', 1)[0] ?? '',
    );
    const subjectLine = lines[index + 2] ?? '';
    if (parent === undefined || !subjectLine.startsWith(indent)) {
      return unexpected(args, `malformed header for ${sha}`);
    }
    let end = index + 3;
    while (end < lines.length && !headerPattern.test(lines[end] ?? '')) {
      end += 1;
    }
    const patch = lines
      .slice(index + 3, end)
      .join('\n')
      .replaceAll(/^\n+|\n+$/gu, '');
    let terminated = patch;
    if (patch !== '') {
      terminated = `${patch}\n`;
    }
    const files = parseUnifiedDiff(terminated);
    if (!files.ok) {
      return unexpected(args, `${sha}: line ${String(files.error.line)}: ${files.error.message}`);
    }
    commits.push({
      sha,
      parent,
      subject: subjectLine.slice(indent.length),
      patchId: patchIds.get(sha),
      files: files.value,
    });
    index = end;
  }
  return ok(commits);
}

function unexpected(args: readonly string[], message: string): Result<never, GitError> {
  return err({ kind: 'unexpected-output', args, message });
}
