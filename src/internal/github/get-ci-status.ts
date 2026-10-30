import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { CiBucket, CiCheck, CiStatus } from './ci-status.ts';
import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubClient, GithubRequest } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import { parseLinkHeader } from './parse-link-header.ts';
import { summarizeCiStatus } from './summarize-ci-status.ts';

/** The ETags of both first pages; only set when each endpoint fit on one page. */
export interface CiEtags {
  readonly statuses: string | undefined;
  readonly checkRuns: string | undefined;
}

export type CiStatusResult =
  | { readonly kind: 'modified'; readonly value: CiStatus; readonly etags: CiEtags }
  | { readonly kind: 'not-modified' };

const failureConclusions = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

const checkRunSchema = z
  .object({
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    html_url: z.string().nullable(),
    details_url: z.string().nullable().optional(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
  })
  .transform((raw): CiCheck => {
    const isCompleted = raw.status === 'completed';
    const conclusion = isCompleted ? (raw.conclusion ?? undefined) : undefined;
    return {
      source: 'check-run',
      name: raw.name,
      status: isCompleted ? 'completed' : raw.status === 'in_progress' ? 'in-progress' : 'queued',
      conclusion,
      bucket: checkRunBucket(conclusion),
      url: raw.html_url ?? raw.details_url ?? undefined,
      startedAt: raw.started_at ?? undefined,
      completedAt: raw.completed_at ?? undefined,
    };
  });

const checkRunsPageSchema = z
  .object({ check_runs: z.array(checkRunSchema) })
  .transform((raw) => raw.check_runs);

const statusSchema = z
  .object({
    context: z.string(),
    state: z.enum(['error', 'failure', 'pending', 'success']),
    target_url: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((raw): CiCheck => ({
    source: 'status',
    name: raw.context,
    status: raw.state === 'pending' ? 'queued' : 'completed',
    conclusion: raw.state === 'pending' ? undefined : raw.state,
    bucket: raw.state === 'error' ? 'failure' : raw.state,
    url: raw.target_url ?? undefined,
    startedAt: raw.created_at,
    completedAt: raw.state === 'pending' ? undefined : raw.updated_at,
  }));

const combinedStatusSchema = z
  .object({ statuses: z.array(statusSchema) })
  .transform((raw) => raw.statuses);

/**
 * CI for one commit: its combined status (`GET …/commits/{sha}/status`, the latest status per
 * context) and its check runs (`GET …/commits/{sha}/check-runs`, the latest run per name), as
 * one list with a rollup. Pass the previous `etags` when polling: if both endpoints answer 304,
 * the result is `not-modified`; otherwise both are fetched in full.
 */
export async function getCiStatus<E>(
  client: GithubClient<E>,
  commit: { readonly owner: string; readonly repo: string; readonly sha: string },
  options: { readonly etags?: CiEtags; readonly signal?: AbortSignal | undefined } = {},
): Promise<Result<CiStatusResult, GithubError<E>>> {
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  const statusesRequest: GithubRequest = {
    method: 'GET',
    path: githubPath`/repos/${commit.owner}/${commit.repo}/commits/${commit.sha}/status`,
    query: { per_page: 100 },
    ...signal,
  };
  const checkRunsRequest: GithubRequest = {
    method: 'GET',
    path: githubPath`/repos/${commit.owner}/${commit.repo}/commits/${commit.sha}/check-runs`,
    query: { per_page: 100 },
    ...signal,
  };

  const { etags } = options;
  if (etags?.statuses !== undefined && etags.checkRuns !== undefined) {
    const [statuses, checkRuns] = await Promise.all([
      client.send({ ...statusesRequest, etag: etags.statuses }),
      client.send({ ...checkRunsRequest, etag: etags.checkRuns }),
    ]);
    if (!statuses.ok) {
      return statuses;
    }
    if (!checkRuns.ok) {
      return checkRuns;
    }
    if (statuses.value.status === 304 && checkRuns.value.status === 304) {
      return ok({ kind: 'not-modified' });
    }
  }

  const [statuses, checkRuns] = await Promise.all([
    fetchFirstPage(client, statusesRequest, combinedStatusSchema),
    fetchAllPagesWithEtag(client, checkRunsRequest),
  ]);
  if (!statuses.ok) {
    return statuses;
  }
  if (!checkRuns.ok) {
    return checkRuns;
  }
  const checks = [...checkRuns.value.items, ...statuses.value.items];
  return ok({
    kind: 'modified',
    value: {
      sha: commit.sha,
      checks,
      rollup: summarizeCiStatus(checks),
      isTruncated: checkRuns.value.isTruncated,
    },
    etags: { statuses: statuses.value.etag, checkRuns: checkRuns.value.etag },
  });
}

function checkRunBucket(conclusion: string | undefined): CiBucket {
  if (conclusion === undefined) {
    return 'pending';
  }
  if (conclusion === 'success') {
    return 'success';
  }
  if (failureConclusions.has(conclusion)) {
    return 'failure';
  }
  // `neutral`, `skipped`, `stale`, and conclusions GitHub may add later.
  return 'neutral';
}

interface EtaggedPages {
  readonly items: readonly CiCheck[];
  readonly etag: string | undefined;
  readonly isTruncated: boolean;
}

/** The combined status endpoint pages its `statuses`, but 100 contexts per commit is plenty. */
async function fetchFirstPage<E>(
  client: GithubClient<E>,
  request: GithubRequest,
  schema: z.ZodType<readonly CiCheck[]>,
): Promise<Result<EtaggedPages, GithubError<E>>> {
  const response = await client.send(request);
  if (!response.ok) {
    return response;
  }
  const decoded = decodeWith(schema, response.value.body);
  return decoded.ok
    ? ok({ items: decoded.value, etag: response.value.etag, isTruncated: false })
    : err({ kind: 'unexpected-shape', reason: decoded.error });
}

/** Check runs page; an ETag is only kept when everything fit on the first page. */
async function fetchAllPagesWithEtag<E>(
  client: GithubClient<E>,
  request: GithubRequest,
): Promise<Result<EtaggedPages, GithubError<E>>> {
  const first = await client.send(request);
  if (!first.ok) {
    return first;
  }
  const decoded = decodeWith(checkRunsPageSchema, first.value.body);
  if (!decoded.ok) {
    return err({ kind: 'unexpected-shape', reason: decoded.error });
  }
  const next = parseLinkHeader(first.value.link).get('next');
  if (next === undefined) {
    return ok({ items: decoded.value, etag: first.value.etag, isTruncated: false });
  }
  const rest = await fetchAllPages(
    client,
    { method: 'GET', path: next, ...(request.signal !== undefined && { signal: request.signal }) },
    (body) => decodeWith(checkRunsPageSchema, body),
    9,
  );
  if (!rest.ok) {
    return rest;
  }
  return ok({
    items: [...decoded.value, ...rest.value.items],
    etag: undefined,
    isTruncated: rest.value.isTruncated,
  });
}
