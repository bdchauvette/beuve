import { listOpenPullRequests } from '#internal/github/list-open-pull-requests.ts';
import type { PullRequest } from '#internal/github/pull-request.ts';

import type { QueueCache } from './create-queue-cache.ts';
import type { QueueRun } from './queue-run.ts';

/** A repository whose open pull requests to read. */
export interface OpenPullsLookup {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly cache: QueueCache;
}

/**
 * A repository's open pull requests (ADR 0113): one page of the 100 most recently updated,
 * conditional on the last ETag, read once a run however many parts of the refresh ask (agent
 * branches drop those with a pull request; stacks are built from them). A failure is reported
 * and answered with the last list, or none.
 */
export async function readOpenPulls(
  run: QueueRun,
  { host, owner, repo, cache }: OpenPullsLookup,
): Promise<readonly PullRequest[]> {
  const repoKey = `${host}/${owner}/${repo}`.toLowerCase();
  return run.once(`open-pulls ${repoKey}`, async () => {
    const cached = cache.openPulls.get(repoKey);
    const listed = await run.withClient(host, async (client) => {
      return listOpenPullRequests(
        client,
        { owner, repo },
        { ...(cached?.etag !== undefined && { etag: cached.etag }), signal: run.signal },
      );
    });
    if (!listed.ok) {
      run.report(`${host}/${owner}/${repo} pull requests`, listed.error);
      return cached?.pulls ?? [];
    }
    if (listed.value.kind === 'not-modified') {
      return cached?.pulls ?? [];
    }
    const pulls = listed.value.value.items;
    cache.openPulls.set(repoKey, { etag: listed.value.etag, pulls });
    return pulls;
  });
}
