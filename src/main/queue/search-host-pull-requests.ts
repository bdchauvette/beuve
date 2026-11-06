import type { QueueReasonView } from '#contract/ipc-contract.ts';
import { searchPullRequests } from '#internal/github/search-pull-requests.ts';
import type { SearchedPullRequest, SearchResults } from '#internal/github/search-pull-requests.ts';

import type { QueueCache } from './create-queue-cache.ts';
import { pullRequestKeyOf } from './pull-request-key-of.ts';
import type { QueueRun } from './queue-run.ts';

/** A pull request the searches found, and why it is in the queue. */
export interface SearchedEntry {
  readonly pull: SearchedPullRequest;
  readonly reasons: readonly QueueReasonView[];
  /** For review requests: of the viewer by name, or only through a team. */
  readonly request?: 'direct' | 'team';
  /** Its search failed this time; this is the last answer it gave. */
  readonly isStale: boolean;
}

/** One search's answer this refresh: its results, and whether they are the last good ones. */
interface SearchAnswer {
  readonly results: SearchResults;
  readonly isStale: boolean;
}

/** Where to search and what to remember. */
export interface HostSearch {
  readonly host: string;
  readonly cache: QueueCache;
}

const open = 'is:open is:pr archived:false';

const noResults: SearchResults = {
  items: [],
  isTruncated: false,
  hiddenOrganizations: 0,
  scopes: undefined,
};

/** Scopes that let a classic token see the teams a user is on. */
const orgScopes: ReadonlySet<string> = new Set(['read:org', 'write:org', 'admin:org']);

/** The three searches of a refresh (ADR 0113); team requests are `requested` but not `direct`. */
const queries = {
  requested: `${open} review-requested:@me`,
  direct: `${open} user-review-requested:@me`,
  authored: `${open} author:@me`,
} as const;

/**
 * The open pull requests waiting on the viewer on one host (ADR 0113): review requests (direct
 * or through a team) and their own. Three searches, one after the other, each conditional on its
 * last ETag; a failed one is reported and answered from its last result.
 */
export async function searchHostPullRequests(
  run: QueueRun,
  { host, cache }: HostSearch,
): Promise<ReadonlyMap<string, SearchedEntry>> {
  const search = async (query: string): Promise<SearchAnswer> => {
    const cacheKey = `${host} ${query}`;
    const cached = cache.searches.get(cacheKey);
    const answer = await run.withClient(host, async (client) => {
      return searchPullRequests(client, query, {
        ...(cached?.etag !== undefined && { etag: cached.etag }),
        signal: run.signal,
      });
    });
    if (!answer.ok) {
      run.report(`${host} search`, answer.error);
      return { results: cached?.results ?? noResults, isStale: true };
    }
    if (answer.value.kind === 'not-modified') {
      return { results: cached?.results ?? noResults, isStale: cached === undefined };
    }
    cache.searches.set(cacheKey, { etag: answer.value.etag, results: answer.value.value });
    return { results: answer.value.value, isStale: false };
  };
  const requested = await search(queries.requested);
  const direct = await search(queries.direct);
  const authored = await search(queries.authored);
  warnIncomplete(run, { host, answers: [requested, direct, authored] });
  const directKeys = new Set(direct.results.items.map((pull) => pullRequestKeyOf(host, pull)));
  const entries = new Map<string, SearchedEntry>();
  const add = (pull: SearchedPullRequest, reason: QueueReasonView, isStale: boolean): void => {
    const key = pullRequestKeyOf(host, pull);
    const existing = entries.get(key);
    let request: SearchedEntry['request'];
    if (reason === 'requested') {
      request = 'team';
      if (directKeys.has(key)) {
        request = 'direct';
      }
    }
    if (existing === undefined) {
      entries.set(key, {
        pull,
        reasons: [reason],
        ...(request !== undefined && { request }),
        isStale,
      });
      return;
    }
    if (existing.reasons.includes(reason)) {
      return;
    }
    entries.set(key, {
      ...existing,
      reasons: [...existing.reasons, reason],
      ...(request !== undefined && { request }),
      isStale: existing.isStale || isStale,
    });
  };
  for (const pull of requested.results.items) {
    add(pull, 'requested', requested.isStale);
  }
  for (const pull of direct.results.items) {
    add(pull, 'requested', direct.isStale);
  }
  for (const pull of authored.results.items) {
    add(pull, 'authored', authored.isStale);
  }
  return entries;
}

/** A host's search answers, to check for what they may be missing. */
interface SearchedHost {
  readonly host: string;
  readonly answers: readonly SearchAnswer[];
}

/**
 * Says when the searches may have missed review requests (ADR 0113): results cut off at the page
 * cap, organizations SAML SSO hid from an unauthorized token, or a classic token without
 * `read:org`, which cannot see team requests. A token without `X-OAuth-Scopes` is not judged.
 */
function warnIncomplete(run: QueueRun, { host, answers }: SearchedHost): void {
  const source = `${host} search`;
  const fresh = answers.filter((answer) => !answer.isStale).map((answer) => answer.results);
  if (fresh.some((results) => results.isTruncated)) {
    run.warn({
      kind: 'truncated',
      source,
      message: `GitHub had more pull requests on ${host} than the queue reads (200 a search); the oldest updated are missing.`,
    });
  }
  const hidden = Math.max(0, ...fresh.map((results) => results.hiddenOrganizations));
  if (hidden > 0) {
    let organizations = `${String(hidden)} organizations`;
    if (hidden === 1) {
      organizations = 'one organization';
    }
    run.warn({
      kind: 'sso',
      source,
      message: `Pull requests from ${organizations} are missing on ${host}: authorize your token for their SAML single sign-on.`,
      remedy: `gh auth refresh -h ${host}`,
    });
  }
  const scopes = fresh.find((results) => results.scopes !== undefined)?.scopes;
  if (scopes?.every((scope) => !orgScopes.has(scope)) === true) {
    run.warn({
      kind: 'scopes',
      source,
      message: `Your ${host} token lacks the read:org scope, so review requests to your teams may be missing.`,
      remedy: `gh auth refresh -h ${host} -s read:org`,
    });
  }
}
