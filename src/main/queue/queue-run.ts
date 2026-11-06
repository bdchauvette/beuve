import type { QueueProblemView } from '#contract/ipc-contract.ts';
import type { AuthError } from '#internal/auth/auth-error.ts';
import type { GithubClient } from '#internal/github/github-client.ts';
import type { GithubError } from '#internal/github/github-error.ts';
import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';

import type { GithubClients, InvalidHost } from '../github/create-github-clients.ts';
import { failureFromGithubError } from '../github/failure-from-github-error.ts';

/** A GitHub call's failure as one refresh sees it. */
export type QueueCallError = GithubError<AuthError> | InvalidHost;

/** What a refresh runs with. */
export interface QueueRunOptions {
  readonly clients: GithubClients;
  readonly signal: AbortSignal;
}

/** Retried no sooner than this when GitHub says it is rate limited without saying until when. */
const unknownReset = Temporal.Duration.from({ minutes: 1 });

/**
 * One refresh of the review queue (ADR 0113): its GitHub calls and the problems they hit. Once a
 * call is rate limited, the rest of the run asks nothing more and fails each call the same way,
 * so a limit is met once rather than once per item.
 */
export class QueueRun {
  private readonly clients: GithubClients;
  private resetAt: string | undefined;
  private isLimited = false;
  private readonly shared = new Map<string, Promise<unknown>>();
  readonly problems: QueueProblemView[] = [];
  readonly signal: AbortSignal;

  constructor(options: QueueRunOptions) {
    this.clients = options.clients;
    this.signal = options.signal;
  }

  /** When the rate limit this run met resets, if it met one. */
  get rateLimitedUntil(): string | undefined {
    if (!this.isLimited) {
      return undefined;
    }
    return this.resetAt ?? Temporal.Now.instant().add(unknownReset).toString();
  }

  /** Runs `call` with the host's client, unless the run already met a rate limit. */
  async withClient<T>(
    host: string,
    call: (client: GithubClient<AuthError>) => Promise<Result<T, GithubError<AuthError>>>,
  ): Promise<Result<T, QueueCallError>> {
    if (this.isLimited) {
      return err({
        kind: 'rate-limited',
        message: 'GitHub’s rate limit was reached earlier in this refresh',
        resetAt: this.resetAt,
      });
    }
    const result = await this.clients.withClient(host, call);
    if (!result.ok && result.error.kind === 'rate-limited') {
      this.isLimited = true;
      this.resetAt = result.error.resetAt;
    }
    return result;
  }

  /**
   * `read`'s answer, read once a run under `key`: a second caller (the branch listing and the
   * stacks both read a repository's open pull requests) gets the first one's.
   */
  async once<T>(key: string, read: () => Promise<T>): Promise<T> {
    const known = this.shared.get(key);
    if (known !== undefined) {
      return known as Promise<T>;
    }
    const reading = read();
    this.shared.set(key, reading);
    return reading;
  }

  /** Records that `source` failed; its items stay as the last refresh left them. */
  report(source: string, error: QueueCallError): void {
    const { message, remedy } = failureFromGithubError(error, source);
    this.warn({ kind: 'failed', source, message, ...(remedy !== undefined && { remedy }) });
  }

  /** Records why the queue may be incomplete, once per kind and source. */
  warn(problem: QueueProblemView): void {
    const isKnown = this.problems.some((known) => {
      return known.kind === problem.kind && known.source === problem.source;
    });
    if (!isKnown) {
      this.problems.push(problem);
    }
  }
}
