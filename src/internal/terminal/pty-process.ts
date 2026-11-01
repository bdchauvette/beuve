/** A pseudo-terminal's size in character cells. */
export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

/** How a pseudo-terminal's process ended: `signal` is the signal number, if one ended it. */
export interface PtyExit {
  readonly exitCode: number;
  readonly signal: number | undefined;
}

/** What to start in a new pseudo-terminal. */
export interface PtySpawnOptions {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly size: TerminalSize;
}

/** A running pseudo-terminal: the seam between the terminal service and `node-pty`. */
export interface PtyProcess {
  readonly pid: number;
  readonly write: (data: string) => void;
  readonly resize: (size: TerminalSize) => void;
  /** Sends SIGHUP to the shell's process group, as closing a terminal window does. */
  readonly kill: () => void;
  /** Output as UTF-8 text. Returns a function that stops listening. */
  readonly onData: (listener: (data: string) => void) => () => void;
  readonly onExit: (listener: (exit: PtyExit) => void) => () => void;
}

/** Starts a pseudo-terminal; rejects with a readable message when it cannot. */
export type PtySpawner = (options: PtySpawnOptions) => Promise<PtyProcess>;
