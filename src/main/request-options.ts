/** Per-call options a service method takes from its IPC handler. */
export interface RequestOptions {
  /**
   * Aborts the call's git work (as each operation's interruption policy says, ADR 0079) when a
   * newer request of its kind supersedes it, the renderer cancels it, or its window closes.
   */
  readonly signal?: AbortSignal | undefined;
}
