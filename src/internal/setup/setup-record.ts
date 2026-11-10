/** The reviewer's setup command for one repository (ADR 0130). */
export interface SetupCommandRecord {
  /** The repository's remote as `host/owner/repo`, lowercase. */
  readonly repository: string;
  /** One shell command line, as the reviewer wrote it (see `parseSetupCommand`). */
  readonly command: string;
  readonly updatedAt: string;
}

/** A setup that finished successfully in the checkout of a session's head. */
export interface SetupRun {
  readonly sessionId: string;
  readonly headSha: string;
  readonly checkout: string;
  readonly finishedAt: string;
}

/** Expected failures of the setup store. */
export interface SetupStoreError {
  readonly kind: 'corrupt-row';
  readonly table: 'setup_commands' | 'setup_runs';
  readonly reason: string;
}
