/**
 * Where a server's program comes from (ADR 0111): `builtin` is shipped with beuve, `path` is a
 * command found on the reviewer's `PATH` (or given absolutely), `project` is a program that came
 * with the reviewed checkout, which runs code from the branch under review.
 */
export type ServerSource = 'builtin' | 'path' | 'project';

/** Where a definition came from: beuve's own table, or the reviewer's configuration (ADR 0111). */
export type DefinitionOrigin = 'builtin' | 'reviewer';

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
  /**
   * Names of files or directories that mark the root a server runs in, such as `go.mod`: the
   * nearest directory from the file up to the checkout that holds one, else the checkout (ADR 0111).
   */
  readonly rootMarkers?: readonly string[];
  /**
   * `false` hides this server's diagnostics while it still answers hover, definition, call
   * hierarchy and symbols (ADR 0111): for a noisy linter, say, that you would rather keep than
   * remove. It is not asked for diagnostics, so it is not even started for them. On by default.
   */
  readonly diagnostics?: boolean;
  /** Where the program comes from; the trust check decides on it before the server starts. */
  readonly source: ServerSource;
  /** Where this definition came from; beuve's own when absent. */
  readonly origin?: DefinitionOrigin;
  readonly initializationOptions?: unknown;
  /** Answers `workspace/configuration` by dotted section, and is sent once after `initialized`. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Variables added to the minimal environment the server runs in. */
  readonly env?: Readonly<Record<string, string>>;
  /** Names of further variables of the reviewer's environment to pass on, such as `GOPATH`. */
  readonly inheritEnv?: readonly string[];
  /**
   * After a push-diagnostics report, how long the server must stay quiet before the report counts
   * as settled. Servers that publish syntax and semantic results separately need more.
   */
  readonly diagnosticsQuiet: Temporal.Duration;
}
