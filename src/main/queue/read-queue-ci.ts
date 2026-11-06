import type { QueueCiView } from '#contract/ipc-contract.ts';
import { getCiStatus } from '#internal/github/get-ci-status.ts';

import type { QueueCache } from './create-queue-cache.ts';
import type { QueueRun } from './queue-run.ts';

/** A queue item's head commit, whose CI to read. */
export interface QueueCiTarget {
  readonly host: string;
  /** The item's key, under which its CI is cached. */
  readonly key: string;
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
  readonly cache: QueueCache;
}

/**
 * The CI of a queue item's head (ADR 0113), asked with the last ETags while the head is the same,
 * so an unchanged head costs two 304s. A failure is reported; the last answer for the same head
 * stands in.
 */
export async function readQueueCi(
  run: QueueRun,
  { host, key, owner, repo, sha, cache }: QueueCiTarget,
): Promise<QueueCiView | undefined> {
  const cached = cache.ci.get(key);
  let sameHead = cached;
  if (cached?.sha !== sha) {
    sameHead = undefined;
  }
  const answer = await run.withClient(host, async (client) => {
    return getCiStatus(
      client,
      { owner, repo, sha },
      { ...(sameHead?.etags !== undefined && { etags: sameHead.etags }), signal: run.signal },
    );
  });
  if (!answer.ok) {
    run.report(key, answer.error);
    return sameHead?.ci;
  }
  if (answer.value.kind === 'not-modified') {
    return sameHead?.ci;
  }
  const { rollup } = answer.value.value;
  const ci: QueueCiView = { overall: rollup.overall, failing: rollup.counts.failure };
  cache.ci.set(key, { sha, etags: answer.value.etags, ci });
  return ci;
}
