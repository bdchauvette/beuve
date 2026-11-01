import type { ToolUse } from './plan-install.ts';

/**
 * Where a checkout's install stands (ADR 0089): queued for a slot (`pending`), `running`, `done`,
 * `failed` (with a reason, cancellation included) or `declined` at the lockfile safeguard.
 */
export type InstallState = 'pending' | 'running' | 'done' | 'failed' | 'declined';

/** The stored install of one beuve checkout, shared by every session at its commit. */
export interface DependencyInstall {
  readonly checkoutPath: string;
  readonly repoPath: string;
  readonly commitSha: string;
  readonly state: InstallState;
  readonly tools: readonly ToolUse[];
  readonly reason: string | undefined;
  /** The last lines of the install log. */
  readonly logTail: string;
  /** ISO instant of the last change. */
  readonly updatedAt: string;
}

/** The safeguard's answer for one session head (ADR 0090), and the inputs it was asked about. */
export interface InstallDecision {
  readonly sessionId: string;
  readonly headSha: string;
  readonly decision: 'install' | 'decline';
  readonly inputs: readonly string[];
  readonly decidedAt: string;
}

/** A repository's install settings: the safeguard switch and the Settings override's JSON text. */
export interface RepositoryInstallSettings {
  readonly repoPath: string;
  readonly safeguard: boolean;
  readonly override: string | undefined;
}
