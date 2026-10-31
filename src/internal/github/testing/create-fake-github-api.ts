import { createHash } from 'node:crypto';

import type { FetchLike } from '../github-client.ts';

/** One pull request the fake serves, in the base repository `owner/repo`. */
export interface FakePullRequest {
  readonly number: number;
  title: string;
  body: string;
  author: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  isDraft: boolean;
  state: 'open' | 'closed';
  updatedAt: string;
}

/** One check run or status for a commit, as the fake reports it. */
export interface FakeCheck {
  readonly kind: 'check-run' | 'status';
  readonly name: string;
  /** For check runs: `queued`, `in_progress` or a conclusion; for statuses: their state. */
  readonly result: string;
}

/** A review already on a pull request, as `GET …/reviews` lists it. */
export interface FakeSubmittedReview {
  readonly reviewer: string;
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  readonly commitSha: string;
  readonly submittedAt: string;
}

export interface FakeReviewRequest {
  readonly number: number;
  readonly token: string | undefined;
  readonly body: {
    readonly commit_id: string;
    readonly event: string;
    readonly body: string;
    readonly comments: readonly { readonly path: string; readonly line: number }[];
  };
}

export interface FakeHttpRequest {
  readonly method: string;
  /** Path and query below the API root, e.g. `/repos/o/r/pulls/1`. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export interface FakeHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export interface FakeGithubApi {
  readonly owner: string;
  readonly repo: string;
  readonly pullRequests: Map<number, FakePullRequest>;
  /** Checks by commit sha. */
  readonly checks: Map<string, FakeCheck[]>;
  /** Reviews already submitted, by pull request number. */
  readonly submittedReviews: Map<number, FakeSubmittedReview[]>;
  /** Users and team slugs asked to review, by pull request number. */
  readonly requestedReviewers: Map<number, { users: string[]; teams: string[] }>;
  /** The login the token belongs to: GitHub refuses its approvals on its own pull requests. */
  viewer: string;
  /** Tokens the fake accepts; any other bearer token gets 401. */
  readonly validTokens: Set<string>;
  /**
   * When set, reviews whose inline comments touch these paths are refused with GitHub's
   * "pull_request_review_thread.line" 422, as when a comment is off the diff.
   */
  readonly rejectCommentPaths: Set<string>;
  /** Every review the fake accepted. */
  readonly reviews: FakeReviewRequest[];
  /** Every request, in order, as `METHOD path`. */
  readonly log: string[];
  /** Answers a request below the API root. */
  readonly handle: (request: FakeHttpRequest) => FakeHttpResponse;
  /** A `fetch` for the client's `fetch` option, serving `https://api.github.com/…`. */
  readonly fetch: FetchLike;
}

const apiRoot = 'https://api.github.com';
// eslint-disable-next-line unicorn/no-null -- GitHub's JSON spells absent values as null.
const jsonNull = null;

/**
 * A small stateful stand-in for GitHub's REST API for one repository: pull requests (with
 * ETags and 304s), the open-pull-request list used for stacks, commit statuses and check runs,
 * and review submission with GitHub's own-pull-request and off-diff 422s. Tokens are checked,
 * so a revoked token answers 401. It never touches the network; `handle` can also back a local
 * HTTP server for a development run.
 */
export function createFakeGithubApi(owner = 'octo-org', repo = 'hello-world'): FakeGithubApi {
  const api: FakeGithubApi = {
    owner,
    repo,
    pullRequests: new Map(),
    checks: new Map(),
    submittedReviews: new Map(),
    requestedReviewers: new Map(),
    viewer: 'reviewer',
    validTokens: new Set(['gho_fake_token']),
    rejectCommentPaths: new Set(),
    reviews: [],
    log: [],
    handle: (request) => {
      return handle(api, request);
    },
    fetch: async (url, init): Promise<Response> => {
      await Promise.resolve();
      if (!url.startsWith(`${apiRoot}/`)) {
        throw new TypeError(`fake GitHub only serves ${apiRoot}: ${url}`);
      }
      const answer = handle(api, {
        method: init.method ?? 'GET',
        path: url.slice(apiRoot.length),
        headers: { ...(init.headers as Record<string, string>) },
        body: typeof init.body === 'string' ? init.body : undefined,
      });
      return new Response(answer.body, { status: answer.status, headers: answer.headers });
    },
  };
  return api;
}

function handle(api: FakeGithubApi, request: FakeHttpRequest): FakeHttpResponse {
  const url = new URL(request.path, apiRoot);
  api.log.push(`${request.method} ${url.pathname}${url.search}`);
  const token = bearer(request.headers);
  if (token === undefined || !api.validTokens.has(token)) {
    return json(401, { message: 'Bad credentials' });
  }
  const prefix = `/repos/${api.owner}/${api.repo}`;
  if (!url.pathname.startsWith(`${prefix}/`)) {
    return json(404, { message: 'Not Found' });
  }
  const rest = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  const [first, second, third] = rest;
  if (first === 'pulls' && second === undefined && request.method === 'GET') {
    return conditional(request, listPulls(api, url.searchParams));
  }
  const pull = first === 'pulls' ? api.pullRequests.get(Number(second)) : undefined;
  if (first === 'pulls' && pull === undefined) {
    return json(404, { message: 'Not Found' });
  }
  if (third === undefined && pull !== undefined && request.method === 'GET') {
    return conditional(request, githubPullFrom(api, pull));
  }
  if (third === 'reviews' && pull !== undefined && request.method === 'GET') {
    const listed = api.submittedReviews.get(pull.number) ?? [];
    return conditional(
      request,
      listed.map((entry, index) => {
        return {
          id: index + 1,
          user: { login: entry.reviewer },
          state: entry.state,
          commit_id: entry.commitSha,
          submitted_at: entry.state === 'PENDING' ? jsonNull : entry.submittedAt,
        };
      }),
    );
  }
  if (third === 'requested_reviewers' && pull !== undefined && request.method === 'GET') {
    const requested = api.requestedReviewers.get(pull.number) ?? { users: [], teams: [] };
    return conditional(request, {
      users: requested.users.map((login) => {
        return { login };
      }),
      teams: requested.teams.map((slug) => {
        return { slug };
      }),
    });
  }
  if (third === 'reviews' && pull !== undefined && request.method === 'POST') {
    return review(api, pull, token, request.body);
  }
  if (first === 'commits' && second !== undefined && request.method === 'GET') {
    const checks = api.checks.get(second) ?? [];
    if (third === 'status') {
      return conditional(request, { statuses: statuses(checks) });
    }
    if (third === 'check-runs') {
      const runs = checkRuns(api, checks);
      return conditional(request, { total_count: runs.length, check_runs: runs });
    }
  }
  return json(404, { message: 'Not Found' });
}

function bearer(headers: Readonly<Record<string, string>>): string | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization');
  return value?.[1].startsWith('Bearer ') === true ? value[1].slice('Bearer '.length) : undefined;
}

function listPulls(api: FakeGithubApi, query: URLSearchParams): unknown[] {
  const head = query.get('head');
  const base = query.get('base');
  const listed: unknown[] = [];
  for (const pull of api.pullRequests.values()) {
    const isListed =
      pull.state === 'open' &&
      (head === null || head === `${api.owner}:${pull.headRef}`) &&
      (base === null || base === pull.baseRef);
    if (isListed) {
      listed.push(githubPullFrom(api, pull));
    }
  }
  return listed;
}

function review(
  api: FakeGithubApi,
  pull: FakePullRequest,
  token: string,
  rawBody = '{}',
): FakeHttpResponse {
  const body = JSON.parse(rawBody) as FakeReviewRequest['body'];
  if (pull.author === api.viewer && body.event !== 'COMMENT') {
    const verb = body.event === 'APPROVE' ? 'approve' : 'request changes on';
    return json(422, {
      message: 'Unprocessable Entity',
      errors: [`Can not ${verb} your own pull request`],
    });
  }
  if (body.commit_id !== pull.headSha) {
    return json(422, {
      message: 'Unprocessable Entity',
      errors: ['commit_id is not part of the pull request'],
    });
  }
  if (body.comments.some((comment) => api.rejectCommentPaths.has(comment.path))) {
    return json(422, {
      message: 'Unprocessable Entity',
      errors: ['Pull request review thread line must be part of the diff'],
    });
  }
  api.reviews.push({ number: pull.number, token, body });
  const id = api.reviews.length;
  return json(200, {
    id,
    state:
      body.event === 'APPROVE'
        ? 'APPROVED'
        : body.event === 'COMMENT'
          ? 'COMMENTED'
          : 'CHANGES_REQUESTED',
    html_url: `https://github.com/${api.owner}/${api.repo}/pull/${String(pull.number)}#pullrequestreview-${String(id)}`,
    commit_id: body.commit_id,
  });
}

function githubPullFrom(api: FakeGithubApi, pull: FakePullRequest): Record<string, unknown> {
  const repository = {
    name: api.repo,
    full_name: `${api.owner}/${api.repo}`,
    clone_url: `https://github.com/${api.owner}/${api.repo}.git`,
    owner: { login: api.owner },
  };
  return {
    number: pull.number,
    title: pull.title,
    body: pull.body,
    state: pull.state,
    draft: pull.isDraft,
    merged_at: jsonNull,
    user: { login: pull.author },
    html_url: `https://github.com/${api.owner}/${api.repo}/pull/${String(pull.number)}`,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: pull.updatedAt,
    base: { ref: pull.baseRef, sha: pull.baseSha, repo: repository },
    head: { ref: pull.headRef, sha: pull.headSha, repo: repository },
  };
}

function statuses(checks: readonly FakeCheck[]): unknown[] {
  return checks
    .filter((check) => check.kind === 'status')
    .map((check) => {
      return {
        context: check.name,
        state: check.result,
        target_url: jsonNull,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };
    });
}

function checkRuns(api: FakeGithubApi, checks: readonly FakeCheck[]): unknown[] {
  return checks
    .filter((check) => check.kind === 'check-run')
    .map((check, index) => {
      const isRunning = check.result === 'queued' || check.result === 'in_progress';
      return {
        name: check.name,
        status: isRunning ? check.result : 'completed',
        conclusion: isRunning ? jsonNull : check.result,
        html_url: `https://github.com/${api.owner}/${api.repo}/runs/${String(index + 1)}`,
        started_at: '2026-10-01T00:00:00Z',
        completed_at: isRunning ? jsonNull : '2026-10-01T00:01:00Z',
      };
    });
}

function conditional(request: FakeHttpRequest, value: unknown): FakeHttpResponse {
  const text = JSON.stringify(value);
  const etag = `"${createHash('sha256').update(text).digest('hex').slice(0, 16)}"`;
  const match = Object.entries(request.headers).find(([name]) => {
    return name.toLowerCase() === 'if-none-match';
  });
  return match?.[1] === etag
    ? { status: 304, headers: { etag }, body: undefined }
    : { status: 200, headers: { 'content-type': 'application/json', etag }, body: text };
}

function json(status: number, value: unknown): FakeHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}
