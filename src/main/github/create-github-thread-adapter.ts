import type { GithubFailureView, IpcResult, ReviewThreadsView } from '#contract/ipc-contract.ts';
import { listReviewThreads } from '#internal/github/list-review-threads.ts';
import type { SessionSource } from '#internal/session/session.ts';
import { ok } from '#x/result/ok.ts';

import type { ThreadAdapter } from '../threads/create-thread-services.ts';

import type { GithubClients } from './create-github-clients.ts';
import { failureFromGithubError } from './failure-from-github-error.ts';

export interface GithubThreadAdapterOptions {
  readonly clients: GithubClients;
}

/** GitHub's reading of other reviewers' line comments on a pull request (ADR 0140). */
export function createGithubThreadAdapter(options: GithubThreadAdapterOptions): ThreadAdapter {
  return {
    supports: (source): boolean => {
      return source.kind === 'github-pull-request';
    },
    list: async (source, call = {}): Promise<IpcResult<ReviewThreadsView | GithubFailureView>> => {
      if (source.kind !== 'github-pull-request') {
        return ok({ kind: 'unsupported' });
      }
      return listFor(source, options.clients, call.signal);
    },
  };
}

async function listFor(
  source: Extract<SessionSource, { kind: 'github-pull-request' }>,
  clients: GithubClients,
  signal: AbortSignal | undefined,
): Promise<IpcResult<ReviewThreadsView | GithubFailureView>> {
  const { host, owner, repo, number } = source;
  const threads = await clients.withClient(host, async (client) => {
    return listReviewThreads(client, { owner, repo, number }, { signal });
  });
  if (!threads.ok) {
    return ok(failureFromGithubError(threads.error, `${owner}/${repo}#${String(number)}`));
  }
  return ok({ kind: 'threads', ...threads.value });
}
