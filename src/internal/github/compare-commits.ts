import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { RepositoryName } from './get-repository.ts';
import type { ChangeSize } from './pull-request.ts';

/** Compare `head` with `base` (branch names or SHAs) in one repository. */
export interface ComparisonRange extends RepositoryName {
  readonly base: string;
  readonly head: string;
}

/** A commit of a comparison, as the review queue needs it. */
export interface ComparedCommit {
  readonly sha: string;
  readonly message: string;
  /** The GitHub login, else the git author name, else `ghost`. */
  readonly author: string;
  /** The author date. */
  readonly date: string;
}

/** What `head` adds over its merge base with `base`. */
export interface Comparison {
  readonly status: 'ahead' | 'behind' | 'identical' | 'diverged';
  readonly aheadBy: number;
  readonly behindBy: number;
  /** Summed over the files GitHub listed (at most 300; `isTruncated` past that). */
  readonly size: ChangeSize;
  /** Oldest first; GitHub lists at most 250. */
  readonly commits: readonly ComparedCommit[];
  readonly isTruncated: boolean;
}

const maxListedFiles = 300;

const gitAuthorSchema = z.object({ name: z.string().nullable().optional(), date: z.string() });
const gitCommitSchema = z.object({ message: z.string(), author: gitAuthorSchema.nullable() });
const accountSchema = z.object({ login: z.string() });
const fileSchema = z.object({ additions: z.number().int(), deletions: z.number().int() });

const commitSchema = z
  .object({
    sha: z.string(),
    commit: gitCommitSchema,
    author: accountSchema.nullable().optional(),
  })
  .transform((raw): ComparedCommit => {
    return {
      sha: raw.sha.toLowerCase(),
      message: raw.commit.message,
      author: raw.author?.login ?? raw.commit.author?.name ?? 'ghost',
      date: raw.commit.author?.date ?? '',
    };
  });

const comparisonSchema = z
  .object({
    status: z.enum(['ahead', 'behind', 'identical', 'diverged']),
    ahead_by: z.number().int().nonnegative(),
    behind_by: z.number().int().nonnegative(),
    total_commits: z.number().int().nonnegative(),
    commits: z.array(commitSchema),
    files: z.array(fileSchema).optional(),
  })
  .transform((raw): Comparison => {
    const files = raw.files ?? [];
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      additions += file.additions;
      deletions += file.deletions;
    }
    return {
      status: raw.status,
      aheadBy: raw.ahead_by,
      behindBy: raw.behind_by,
      size: { additions, deletions, changedFiles: files.length },
      commits: raw.commits,
      isTruncated: files.length >= maxListedFiles || raw.commits.length < raw.total_commits,
    };
  });

/**
 * `GET /repos/{o}/{r}/compare/{base}...{head}` (ADR 0113): what `head` adds since its merge base
 * with `base` — how far ahead it is, its commits and its size. The review queue reads it once
 * per branch head, for a branch that has no pull request to ask instead.
 */
export async function compareCommits<E>(
  client: GithubClient<E>,
  range: ComparisonRange,
  options: GithubCallOptions = {},
): Promise<Result<Comparison, GithubError<E>>> {
  const spec = `${range.base}...${range.head}`;
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${range.owner}/${range.repo}/compare/${spec}`,
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  const decoded = decodeWith(comparisonSchema, response.value.body);
  if (decoded.ok) {
    return ok(decoded.value);
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}
