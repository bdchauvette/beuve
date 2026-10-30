/**
 * How to run one language server: registry data, no behaviour. One process serves every file
 * whose extension appears in `languageIds`, per workspace root.
 */
export interface ServerDefinition {
  /** Stable key, e.g. `typescript`. */
  readonly id: string;
  /**
   * Executable: a bare name looked up in the search directories and then `PATH`, or an absolute
   * path used as is. Never run through a shell.
   */
  readonly command: string;
  readonly args: readonly string[];
  /** Lowercase file extension (with the dot) → LSP language id. */
  readonly languageIds: Readonly<Record<string, string>>;
  readonly initializationOptions?: unknown;
  /** Answers `workspace/configuration` by dotted section, and is sent once after `initialized`. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Variables added to the minimal environment the server runs in. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * After a push-diagnostics report, how long the server must stay quiet before the report counts
   * as settled. Servers that publish syntax and semantic results separately need more.
   */
  readonly diagnosticsQuiet: Temporal.Duration;
}
