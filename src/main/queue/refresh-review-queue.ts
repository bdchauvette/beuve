import type { QueueProblemView, ReviewQueueItemView } from '#contract/ipc-contract.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import { listFileMarks } from '#internal/session/list-file-marks.ts';
import type { Session } from '#internal/session/session.ts';
import { mapConcurrently } from '#x/async/map-concurrently.ts';

import type { RepositoryKey } from '../github/create-clone-path-settings.ts';
import type { GithubContext } from '../github/github-context.ts';

import { branchItemFrom } from './branch-item-from.ts';
import { branchKeyOf } from './branch-key-of.ts';
import type { QueueCache } from './create-queue-cache.ts';
import { enrichPullRequest } from './enrich-pull-request.ts';
import { listRepositoryBranches } from './list-repository-branches.ts';
import { localReviewFrom } from './local-review-from.ts';
import { pullRequestItemFrom } from './pull-request-item-from.ts';
import { pullRequestKeyOf } from './pull-request-key-of.ts';
import type { QueueItemDraft } from './queue-item-draft.ts';
import { QueueRun } from './queue-run.ts';
import { queueStacksFrom } from './queue-stacks-from.ts';
import { readQueueCi } from './read-queue-ci.ts';
import { searchHostPullRequests } from './search-host-pull-requests.ts';

/** What one refresh reads from and remembers in. */
export interface QueueRefreshOptions {
  readonly context: GithubContext;
  readonly cache: QueueCache;
  /** Branch name prefixes to list agent branches for; none turns branches off. */
  readonly branchPrefixes: readonly string[];
  readonly signal: AbortSignal;
}

/** One refresh's queue, what may be missing from it, and a rate limit it met. */
export interface QueueRefresh {
  readonly items: readonly ReviewQueueItemView[];
  readonly problems: readonly QueueProblemView[];
  /** When the rate limit this refresh met resets; the next refresh waits for it. */
  readonly rateLimitedUntil: string | undefined;
}

/** Items read at once, per host. */
const concurrency = { limit: 4 };

/**
 * Assembles the review queue once (ADR 0113): for each host beuve knows (github.com, and any of a
 * session or remembered clone), the review-request and own-pull-request searches with each pull
 * request's details, reviews and CI; for each known repository, its agent branches without a
 * pull request; then each item's local review state from beuve's sessions and the stacks among
 * them. Failed sources answer from the cache and are listed as problems; nothing throws.
 */
export async function refreshReviewQueue(options: QueueRefreshOptions): Promise<QueueRefresh> {
  const { context, cache, branchPrefixes, signal } = options;
  const run = new QueueRun({ clients: context.clients, signal });
  const sessions = storedSessions(context, run);
  const repositories = knownRepositories(await context.clonePaths.list(), sessions);
  const hosts = new Set(['github.com', ...repositories.map((repository) => repository.host)]);
  const drafts: QueueItemDraft[] = [];
  for (const host of hosts) {
    const viewer = await viewerOn(context, { host, cache });
    const entries = await searchHostPullRequests(run, { host, cache });
    const items = await mapConcurrently([...entries], concurrency, async ([key, entry]) => {
      const enriched = await enrichPullRequest(run, { host, key, pull: entry.pull, cache });
      return pullRequestItemFrom({ host, key, entry, enriched, viewer });
    });
    drafts.push(...items);
  }
  if (branchPrefixes.length > 0) {
    for (const repository of repositories) {
      const candidates = await listRepositoryBranches(run, {
        repository,
        prefixes: branchPrefixes,
        cache,
      });
      const items = await mapConcurrently(candidates, concurrency, async (candidate) => {
        const { host, repository: target, tip } = candidate;
        const ci = await readQueueCi(run, {
          host,
          key: branchKeyOf(host, { owner: target.owner, repo: target.repo, branch: tip.name }),
          owner: target.owner,
          repo: target.repo,
          sha: tip.sha,
          cache,
        });
        return branchItemFrom({ candidate, ci });
      });
      drafts.push(...items);
    }
  }
  return {
    items: withLocalState(context, { drafts, sessions }),
    problems: run.problems,
    rateLimitedUntil: run.rateLimitedUntil,
  };
}

/** Every stored session; none, with a problem, when the table can't be read. */
function storedSessions(context: GithubContext, run: QueueRun): readonly Session[] {
  const listed = listSessions(context.session.db);
  if (listed.ok) {
    return listed.value;
  }
  run.warn({ kind: 'failed', source: 'beuve sessions', message: listed.error.reason });
  return [];
}

/**
 * The repositories to list branches of: those with a remembered clone, then those of pull request
 * and branch sessions, once each (GitHub's names are case-insensitive).
 */
function knownRepositories(
  clones: readonly RepositoryKey[],
  sessions: readonly Session[],
): readonly RepositoryKey[] {
  const known = new Map<string, RepositoryKey>();
  const fromSessions = sessions.flatMap((session): RepositoryKey[] => {
    if (session.source.kind === 'local') {
      return [];
    }
    const { host, owner, repo } = session.source;
    return [{ host, owner, repo }];
  });
  for (const repository of [...clones, ...fromSessions]) {
    const key = `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
    if (!known.has(key)) {
      known.set(key, repository);
    }
  }
  return known.values().toArray();
}

/** A host and the cache that remembers its viewer. */
interface ViewerLookup {
  readonly host: string;
  readonly cache: QueueCache;
}

/** The signed-in login on `host`, asked once a run of the app. */
async function viewerOn(
  context: GithubContext,
  { host, cache }: ViewerLookup,
): Promise<string | undefined> {
  if (cache.viewers.has(host)) {
    return cache.viewers.get(host);
  }
  const described = await context.clients.credentials.describe({ host });
  if (!described.ok) {
    return undefined;
  }
  const login = described.value.account?.login;
  cache.viewers.set(host, login);
  return login;
}

/** The drafts and the sessions to match them with. */
interface LocalStateInput {
  readonly drafts: readonly QueueItemDraft[];
  readonly sessions: readonly Session[];
}

/** Each draft with its local review state and its place in a stack. */
function withLocalState(
  context: GithubContext,
  { drafts, sessions }: LocalStateInput,
): ReviewQueueItemView[] {
  const bySource = new Map<string, Session>();
  for (const session of sessions) {
    const key = sessionKeyOf(session);
    if (key !== undefined && !bySource.has(key)) {
      bySource.set(key, session);
    }
  }
  const stacks = queueStacksFrom(drafts);
  return drafts.map((draft): ReviewQueueItemView => {
    const session = bySource.get(draft.key.toLowerCase());
    let markedFiles = 0;
    if (session !== undefined) {
      const marks = listFileMarks(context.session.db, session.id);
      if (marks.ok) {
        markedFiles = marks.value.length;
      }
    }
    const stack = stacks.get(draft.key);
    return {
      ...draft,
      local: localReviewFrom({ session, markedFiles, headSha: draft.headSha }),
      ...(stack !== undefined && { stack }),
    };
  });
}

/** The queue key a session reviews, lowercase; `undefined` for a local session. */
function sessionKeyOf(session: Session): string | undefined {
  const { source } = session;
  switch (source.kind) {
    case 'local': {
      return undefined;
    }
    case 'github-pull-request': {
      return pullRequestKeyOf(source.host, source).toLowerCase();
    }
    case 'remote-branch': {
      return branchKeyOf(source.host, source).toLowerCase();
    }
  }
}
