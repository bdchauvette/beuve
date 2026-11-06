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
  /** The fork the head branch is in (one of `forks`); the base repository by default. */
  headRepository?: FakeRepositoryName;

  /** Lines and files changed, as `GET …/pulls/{n}` reports them; none by default. */
  size?: { readonly additions: number; readonly deletions: number; readonly changedFiles: number };
}

/** A repository's owner and name. */
export interface FakeRepositoryName {
  readonly owner: string;
  readonly repo: string;
}

/**
 * A fork of the fake's repository: `GET /repos/{o}/{r}` names the fake's repository as its
 * parent and source, its branches answer like the repository's, and it has no pull requests.
 */
export interface FakeFork extends FakeRepositoryName {
  /** Branch tips by branch name. */
  readonly branches: Map<string, string>;
}

/** What `GET …/compare/{base}...{head}` answers for a head (ADR 0113). */
export interface FakeComparison {
  readonly aheadBy: number;
  readonly commits: readonly FakePullCommit[];
  readonly files: readonly { readonly additions: number; readonly deletions: number }[];
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
  /** The words the reviewer wrote with the verdict; none by default. */
  readonly body?: string;
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  readonly commitSha: string;
  readonly submittedAt: string;
}

/** A commit of a pull request, as `GET …/pulls/{n}/commits` lists it. */
export interface FakePullCommit {
  readonly sha: string;
  readonly message: string;
  /** The author's login; `undefined` for a commit whose author has no GitHub account. */
  readonly login: string | undefined;
  readonly authorName: string;
  readonly date: string;
  /** The committer date; the author date by default. */
  readonly committedAt?: string;
}

/** A review request on a pull request, as `GET …/issues/{n}/events` lists it (ADR 0113). */
export interface FakeReviewRequestEvent {
  readonly at: string;
  /** The login asked, for a request of a person. */
  readonly reviewer?: string;
  /** The team slug asked, for a request of a team. */
  readonly team?: string;
}

/** A team the viewer is on, as `GET /user/teams` lists it. */
export interface FakeTeam {
  readonly organization: string;
  readonly slug: string;
}

/** A comment in a pull request's conversation, as `GET …/issues/{n}/comments` lists it. */
export interface FakeConversationComment {
  readonly login: string;
  readonly body: string;
  readonly createdAt: string;
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
  /** Branch tips by branch name, as `GET …/branches/{branch}` reports them (ADR 0112). */
  readonly branches: Map<string, string>;
  /** Forks of the repository, by `owner/repo`. */
  readonly forks: Map<string, FakeFork>;
  /** Pull request numbers each search query (`q`) finds, in this repository (ADR 0113). */
  readonly searches: Map<string, number[]>;
  /** Headers every search answer carries, such as `x-github-sso` or `x-oauth-scopes`. */
  readonly searchHeaders: Record<string, string>;
  /** Comparisons with the default branch, by head SHA (ADR 0113). */
  readonly comparisons: Map<string, FakeComparison>;
  /** What `GET /repos/{o}/{r}` reports as the default branch. */
  defaultBranch: string;
  /** Checks by commit sha. */
  readonly checks: Map<string, FakeCheck[]>;
  /** Reviews already submitted, by pull request number. */
  readonly submittedReviews: Map<number, FakeSubmittedReview[]>;
  /** Commits of each pull request, by pull request number. */
  readonly pullCommits: Map<number, FakePullCommit[]>;
  /** Conversation comments, by pull request number. */
  readonly conversation: Map<number, FakeConversationComment[]>;
  /** Review requests, by pull request number (ADR 0113). */
  readonly reviewRequestEvents: Map<number, FakeReviewRequestEvent[]>;
  /** The viewer's teams; `undefined` answers 403, as for a token without `read:org`. */
  viewerTeams: FakeTeam[] | undefined;
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
 * A small stateful stand-in for GitHub's REST API for one repository: the repository and its
 * branches, pull requests (with ETags and 304s), the open-pull-request list used for stacks and
 * branch sessions, commit statuses and check runs, and review submission with GitHub's
 * own-pull-request and off-diff 422s. Tokens are checked, so a revoked token answers 401. It
 * never touches the network; `handle` can also back a local HTTP server for a development run.
 */
export function createFakeGithubApi({
  owner = 'octo-org',
  repo = 'hello-world',
}: FakeRepository = {}): FakeGithubApi {
  const api: FakeGithubApi = {
    owner,
    repo,
    pullRequests: new Map(),
    branches: new Map(),
    forks: new Map(),
    searches: new Map(),
    searchHeaders: {},
    comparisons: new Map(),
    defaultBranch: 'main',
    checks: new Map(),
    submittedReviews: new Map(),
    requestedReviewers: new Map(),
    reviewRequestEvents: new Map(),
    viewerTeams: [],
    pullCommits: new Map(),
    conversation: new Map(),
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
        body: textBodyOf(init),
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
  if (url.pathname === '/search/issues' && request.method === 'GET') {
    const numbers = api.searches.get(url.searchParams.get('q') ?? '') ?? [];
    const answer = conditional(request, {
      total_count: numbers.length,
      incomplete_results: false,
      items: numbers.flatMap((number) => {
        const pull = api.pullRequests.get(number);
        if (pull === undefined) {
          return [];
        }
        return [searchItemFrom(api, pull)];
      }),
    });
    return { ...answer, headers: { ...answer.headers, ...api.searchHeaders } };
  }
  const forked = handleFork(api, { request, url });
  if (forked !== undefined) {
    return forked;
  }
  if (url.pathname === '/user/teams' && request.method === 'GET') {
    if (api.viewerTeams === undefined) {
      return json(403, { message: 'Resource not accessible by integration' });
    }
    return conditional(
      request,
      api.viewerTeams.map((team) => {
        return { slug: team.slug, organization: { login: team.organization } };
      }),
    );
  }
  const prefix = `/repos/${api.owner}/${api.repo}`;
  if (url.pathname === prefix && request.method === 'GET') {
    return conditional(request, { ...repositoryJson(api), fork: false });
  }
  if (!url.pathname.startsWith(`${prefix}/`)) {
    return json(404, { message: 'Not Found' });
  }
  const rest = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  const [first, second, third] = rest;
  if (first === 'branches' && request.method === 'GET') {
    return branch(request, { branches: api.branches, rest });
  }
  if (first === 'git' && second === 'matching-refs' && third === 'heads') {
    const wanted = `${rest
      .slice(3)
      .map((segment) => decodeURIComponent(segment))
      .join('/')}${trailingSlash(url.pathname)}`;
    const refs = [...api.branches]
      .filter(([name]) => name.startsWith(wanted))
      .map(([name, sha]) => {
        return { ref: `refs/heads/${name}`, object: { sha, type: 'commit' } };
      });
    return conditional(request, refs);
  }
  if (first === 'compare' && second !== undefined && request.method === 'GET') {
    const [base = '', head = ''] = decodeURIComponent(second).split('...', 2);
    const comparison = api.comparisons.get(head);
    if (comparison === undefined || base !== api.defaultBranch) {
      return json(404, { message: 'Not Found' });
    }
    return conditional(request, comparisonFrom(api, comparison));
  }
  if (first === 'pulls' && second === undefined && request.method === 'GET') {
    return conditional(request, listPulls(api, url.searchParams));
  }
  let pull: FakePullRequest | undefined;
  if (first === 'pulls') {
    pull = api.pullRequests.get(Number(second));
  }
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
          submitted_at: submittedAtOf(entry),
          body: entry.body ?? '',
          html_url: `https://github.com/${api.owner}/${api.repo}/pull/${String(pull.number)}#pullrequestreview-${String(index + 1)}`,
        };
      }),
    );
  }
  if (third === 'commits' && pull !== undefined && request.method === 'GET') {
    return conditional(
      request,
      (api.pullCommits.get(pull.number) ?? []).map((entry) => {
        return {
          sha: entry.sha,
          html_url: `https://github.com/${api.owner}/${api.repo}/commit/${entry.sha}`,
          commit: { message: entry.message, author: { name: entry.authorName, date: entry.date } },
          author: authorOf(entry.login),
        };
      }),
    );
  }
  if (first === 'issues' && third === 'comments' && request.method === 'GET') {
    return conditional(
      request,
      (api.conversation.get(Number(second)) ?? []).map((entry, index) => {
        return {
          id: index + 1,
          user: { login: entry.login },
          body: entry.body,
          created_at: entry.createdAt,
          html_url: `https://github.com/${api.owner}/${api.repo}/pull/${String(second)}#issuecomment-${String(index + 1)}`,
        };
      }),
    );
  }
  if (first === 'issues' && third === 'events' && request.method === 'GET') {
    return conditional(
      request,
      (api.reviewRequestEvents.get(Number(second)) ?? []).map((entry) => {
        return {
          event: 'review_requested',
          created_at: entry.at,
          requested_reviewer: requestedOf(entry.reviewer, (login) => {
            return { login };
          }),
          requested_team: requestedOf(entry.team, (slug) => {
            return { slug, name: slug };
          }),
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
    return review(api, pull, { token, rawBody: request.body });
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

/** A request and its parsed URL. */
interface ParsedRequest {
  readonly request: FakeHttpRequest;
  readonly url: URL;
}

/** Answers a request for one of the forks; `undefined` when it is about none of them. */
function handleFork(
  api: FakeGithubApi,
  { request, url }: ParsedRequest,
): FakeHttpResponse | undefined {
  const fork = api.forks.values().find((candidate) => {
    const prefix = `/repos/${candidate.owner}/${candidate.repo}`;
    return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  });
  if (fork === undefined || request.method !== 'GET') {
    return undefined;
  }
  const prefix = `/repos/${fork.owner}/${fork.repo}`;
  const rest = url.pathname.slice(prefix.length).split('/').filter(Boolean);
  const [first, second] = rest;
  if (first === undefined) {
    const upstream = repositoryJson(api);
    return conditional(request, {
      ...repositoryJson({ ...fork, defaultBranch: api.defaultBranch }),
      fork: true,
      parent: upstream,
      source: upstream,
    });
  }
  if (first === 'branches') {
    return branch(request, { branches: fork.branches, rest });
  }
  if (first === 'pulls' && second === undefined) {
    return conditional(request, []);
  }
  return json(404, { message: 'Not Found' });
}

/** A repository and its default branch. */
interface RepositoryDescription extends FakeRepositoryName {
  readonly defaultBranch: string;
}

/** A repository as `GET /repos/{o}/{r}` describes it, without the fork fields. */
function repositoryJson({
  owner,
  repo,
  defaultBranch,
}: RepositoryDescription): Record<string, unknown> {
  return {
    name: repo,
    full_name: `${owner}/${repo}`,
    owner: { login: owner },
    default_branch: defaultBranch,
    html_url: `https://github.com/${owner}/${repo}`,
  };
}

/** A repository's branch tips, and the path segments after the repository. */
interface BranchLookup {
  readonly branches: ReadonlyMap<string, string>;
  readonly rest: readonly string[];
}

function branch(request: FakeHttpRequest, { branches, rest }: BranchLookup): FakeHttpResponse {
  const name = rest
    .slice(1)
    .map((segment) => decodeURIComponent(segment))
    .join('/');
  const sha = branches.get(name);
  if (sha === undefined) {
    return json(404, { message: 'Branch not found' });
  }
  return conditional(request, { name, commit: { sha }, protected: false });
}

function bearer(headers: Readonly<Record<string, string>>): string | undefined {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization');
  if (value?.[1].startsWith('Bearer ') === true) {
    return value[1].slice('Bearer '.length);
  }
  return undefined;
}

function listPulls(api: FakeGithubApi, query: URLSearchParams): unknown[] {
  const head = query.get('head');
  const base = query.get('base');
  const listed: unknown[] = [];
  for (const pull of api.pullRequests.values()) {
    const isListed =
      pull.state === 'open' &&
      (head === null || head === `${pull.headRepository?.owner ?? api.owner}:${pull.headRef}`) &&
      (base === null || base === pull.baseRef);
    if (isListed) {
      listed.push(githubPullFrom(api, pull));
    }
  }
  return listed;
}

/** A review POST: the token that sent it and its JSON body. */
interface ReviewPost {
  readonly token: string;
  readonly rawBody: string | undefined;
}

function review(
  api: FakeGithubApi,
  pull: FakePullRequest,
  { token, rawBody = '{}' }: ReviewPost,
): FakeHttpResponse {
  const body = JSON.parse(rawBody) as FakeReviewRequest['body'];
  if (pull.author === api.viewer && body.event !== 'COMMENT') {
    let verb = 'request changes on';
    if (body.event === 'APPROVE') {
      verb = 'approve';
    }
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
    state: reviewStates.get(body.event) ?? 'CHANGES_REQUESTED',
    html_url: `https://github.com/${api.owner}/${api.repo}/pull/${String(pull.number)}#pullrequestreview-${String(id)}`,
    commit_id: body.commit_id,
  });
}

function githubPullFrom(api: FakeGithubApi, pull: FakePullRequest): Record<string, unknown> {
  const repository = pullRepositoryJson(api);
  const headRepository = pullRepositoryJson(pull.headRepository ?? api);
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
    head: { ref: pull.headRef, sha: pull.headSha, repo: headRepository },
    ...(pull.size !== undefined && {
      additions: pull.size.additions,
      deletions: pull.size.deletions,
      changed_files: pull.size.changedFiles,
    }),
  };
}

function pullRepositoryJson({ owner, repo }: FakeRepositoryName): Record<string, unknown> {
  return {
    name: repo,
    full_name: `${owner}/${repo}`,
    clone_url: `https://github.com/${owner}/${repo}.git`,
    owner: { login: owner },
  };
}

function searchItemFrom(api: FakeGithubApi, pull: FakePullRequest): Record<string, unknown> {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: pull.isDraft,
    user: { login: pull.author },
    html_url: `https://github.com/${api.owner}/${api.repo}/pull/${String(pull.number)}`,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: pull.updatedAt,
    repository_url: `${apiRoot}/repos/${api.owner}/${api.repo}`,
    pull_request: { url: `${apiRoot}/repos/${api.owner}/${api.repo}/pulls/${String(pull.number)}` },
  };
}

function comparisonFrom(api: FakeGithubApi, comparison: FakeComparison): Record<string, unknown> {
  let status = 'ahead';
  if (comparison.aheadBy === 0) {
    status = 'identical';
  }
  return {
    status,
    ahead_by: comparison.aheadBy,
    behind_by: 0,
    total_commits: comparison.commits.length,
    commits: comparison.commits.map((entry) => {
      return {
        sha: entry.sha,
        html_url: `https://github.com/${api.owner}/${api.repo}/commit/${entry.sha}`,
        commit: {
          message: entry.message,
          author: { name: entry.authorName, date: entry.date },
          committer: { name: 'GitHub', date: entry.committedAt ?? entry.date },
        },
        author: authorOf(entry.login),
      };
    }),
    files: comparison.files,
  };
}

function trailingSlash(pathname: string): string {
  if (pathname.endsWith('/')) {
    return '/';
  }
  return '';
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
      const htmlUrl = `https://github.com/${api.owner}/${api.repo}/runs/${String(index + 1)}`;
      if (check.result === 'queued' || check.result === 'in_progress') {
        return {
          name: check.name,
          status: check.result,
          conclusion: jsonNull,
          html_url: htmlUrl,
          started_at: '2026-10-01T00:00:00Z',
          completed_at: jsonNull,
        };
      }
      return {
        name: check.name,
        status: 'completed',
        conclusion: check.result,
        html_url: htmlUrl,
        started_at: '2026-10-01T00:00:00Z',
        completed_at: '2026-10-01T00:01:00Z',
      };
    });
}

function conditional(request: FakeHttpRequest, value: unknown): FakeHttpResponse {
  const text = JSON.stringify(value);
  const etag = `"${createHash('sha256').update(text).digest('hex').slice(0, 16)}"`;
  const match = Object.entries(request.headers).find(([name]) => {
    return name.toLowerCase() === 'if-none-match';
  });
  if (match?.[1] === etag) {
    return { status: 304, headers: { etag }, body: undefined };
  }
  return { status: 200, headers: { 'content-type': 'application/json', etag }, body: text };
}

function json(status: number, value: unknown): FakeHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

/** The repository a fake API serves. */
interface FakeRepository {
  readonly owner?: string;
  readonly repo?: string;
}

const reviewStates: ReadonlyMap<string, string> = new Map([
  ['APPROVE', 'APPROVED'],
  ['COMMENT', 'COMMENTED'],
]);

function textBodyOf(init: RequestInit): string | undefined {
  if (typeof init.body === 'string') {
    return init.body;
  }
  return undefined;
}

function authorOf(login: string | undefined): unknown {
  if (login === undefined) {
    return jsonNull;
  }
  return { login };
}

function submittedAtOf(entry: FakeSubmittedReview): unknown {
  if (entry.state === 'PENDING') {
    return jsonNull;
  }
  return entry.submittedAt;
}

/** A requested reviewer or team as the event spells it; `null` when the event is about the other. */
function requestedOf(name: string | undefined, shape: (name: string) => unknown): unknown {
  if (name === undefined) {
    return jsonNull;
  }
  return shape(name);
}
