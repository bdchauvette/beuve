/** How Claude Code is found and run. Every field has a production default. */
export interface ClaudeCodeSettings {
  /** A fixed executable (tests use Node with the fake script); otherwise resolved per run. */
  readonly command?: string;
  readonly leadingArgs?: readonly string[];
  /** Where `BEUVE_CLAUDE_PATH`, `PATH` and Claude Code's allow-listed variables come from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
  /** Per run; defaults to the review domain's 10 minutes. */
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly killGraceMs?: number;
}
