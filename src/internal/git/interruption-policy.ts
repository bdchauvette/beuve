/**
 * What an abort means for one git command (ADR 0079). Every command a typed operation runs
 * declares one: the runner's options require it, so a new operation can't leave it out.
 *
 * - `read`: changes nothing. An abort sends SIGTERM and the call fails with `aborted`.
 * - `owned-write`: writes only state beuve owns (objects, `refs/beuve/`), which git's own SIGTERM
 *   handler leaves consistent: it removes its lock files and temporary packs before exiting. An
 *   abort sends SIGTERM, waits for git to exit, runs `cleanup` if there is one, and fails with
 *   `aborted`.
 * - `atomic`: must not stop halfway (worktree add, remove and prune). The abort does not reach
 *   git: it runs to completion, still bounded by its timeout, and the call then fails with
 *   `aborted` if the signal aborted meanwhile. An already aborted signal starts nothing.
 */
export type InterruptionPolicy =
  | { readonly kind: 'read' }
  | { readonly kind: 'owned-write'; readonly cleanup?: () => void | Promise<void> }
  | { readonly kind: 'atomic' };
