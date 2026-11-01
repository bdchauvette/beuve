/** What a terminal's environment is built from. */
export interface TerminalEnvironmentSource {
  /** beuve's own environment. */
  readonly inherited: Readonly<Record<string, string | undefined>>;
  readonly checkout: string;
  readonly headSha: string;
  readonly sessionId: string;
  /** The user's clone, which the terminal may read but must not write. */
  readonly repositoryPath: string;
  readonly version: string;
}

const droppedPrefixes: readonly string[] = ['ELECTRON_', 'CHROME_', 'GOOGLE_API_KEY'];
const droppedNames: ReadonlySet<string> = new Set([
  'NODE_OPTIONS',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'NODE_ENV',
]);

/**
 * The environment of a terminal (ADR 0095): the user's own, as a terminal emulator would pass it
 * on, without what only Electron's process needs, plus `TERM` and beuve's `BEUVE_*` variables.
 */
export function terminalEnvironmentFrom(source: TerminalEnvironmentSource): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source.inherited)) {
    if (value === undefined || isDropped(name)) {
      continue;
    }
    environment[name] = value;
  }
  return {
    ...environment,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'beuve',
    TERM_PROGRAM_VERSION: source.version,
    BEUVE_CHECKOUT: source.checkout,
    BEUVE_HEAD_SHA: source.headSha,
    BEUVE_SESSION_ID: source.sessionId,
    BEUVE_REPOSITORY: source.repositoryPath,
  };
}

function isDropped(name: string): boolean {
  return droppedNames.has(name) || droppedPrefixes.some((prefix) => name.startsWith(prefix));
}
