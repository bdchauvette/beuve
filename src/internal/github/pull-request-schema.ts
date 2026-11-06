import { z } from 'zod';

import type { BranchTip, PullRequest } from './pull-request.ts';

const commitSha = z
  .string()
  .regex(/^(?:[\da-f]{40}|[\da-f]{64})$/i)
  .transform((sha) => sha.toLowerCase());

const repositorySchema = z.object({
  name: z.string(),
  full_name: z.string(),
  clone_url: z.string(),
  owner: z.object({ login: z.string() }),
});

const branchSchema = z.object({
  ref: z.string(),
  sha: commitSha,
  repo: repositorySchema.nullable(),
});

/**
 * GitHub's pull request object (`GET /repos/{o}/{r}/pulls/{n}`, and the list endpoint, which omits
 * the `mergeable*` fields) decoded into a {@link PullRequest}. Unknown keys are dropped.
 */
export const pullRequestSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(['open', 'closed']),
    draft: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    user: z.object({ login: z.string() }).nullable(),
    html_url: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    base: branchSchema,
    head: branchSchema,
    mergeable: z.boolean().nullable().optional(),
    mergeable_state: z.string().optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
    changed_files: z.number().int().nonnegative().optional(),
  })
  .transform((raw): PullRequest => {
    const base = tipFrom(raw.base);
    const head = tipFrom(raw.head);
    return {
      number: raw.number,
      title: raw.title,
      body: raw.body ?? '',
      state: stateFrom(raw.state, raw.merged_at),
      isDraft: raw.draft ?? false,
      author: raw.user?.login ?? 'ghost',
      base,
      head,
      isCrossRepository:
        head.repository === undefined || head.repository.fullName !== base.repository?.fullName,
      mergeable: mergeableFrom(raw.mergeable),
      mergeableState: raw.mergeable_state,
      htmlUrl: raw.html_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      ...sizeFrom(raw),
    };
  });

/** The size fields of a pull request object; list endpoints leave them out. */
interface RawSize {
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly changed_files?: number | undefined;
}

/** The change's size, when the endpoint reports all of it. */
function sizeFrom(raw: RawSize): Pick<PullRequest, 'size'> {
  if (
    raw.additions === undefined ||
    raw.deletions === undefined ||
    raw.changed_files === undefined
  ) {
    return {};
  }
  return {
    size: { additions: raw.additions, deletions: raw.deletions, changedFiles: raw.changed_files },
  };
}

function stateFrom(
  state: 'open' | 'closed',
  mergedAt: string | null | undefined,
): PullRequest['state'] {
  if (state === 'open') {
    return 'open';
  }
  if (mergedAt == undefined) {
    return 'closed';
  }
  return 'merged';
}

function mergeableFrom(mergeable: boolean | null | undefined): PullRequest['mergeable'] {
  if (mergeable == undefined) {
    return 'unknown';
  }
  if (mergeable) {
    return 'mergeable';
  }
  return 'conflicting';
}

function tipFrom(raw: z.infer<typeof branchSchema>): BranchTip {
  if (raw.repo === null) {
    return { ref: raw.ref, sha: raw.sha, repository: undefined };
  }
  return {
    ref: raw.ref,
    sha: raw.sha,
    repository: {
      owner: raw.repo.owner.login,
      name: raw.repo.name,
      fullName: raw.repo.full_name,
      cloneUrl: raw.repo.clone_url,
    },
  };
}
