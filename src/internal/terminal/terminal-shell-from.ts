/** The program and arguments that start a terminal's shell. */
export interface TerminalShell {
  readonly file: string;
  readonly args: readonly string[];
}

/** What picks the shell. */
export interface TerminalShellSource {
  /** `$SHELL` in beuve's environment. */
  readonly shell: string | undefined;
  readonly platform: NodeJS.Platform;
}

/**
 * The user's shell as a login shell (ADR 0095), so a launch from the Dock or a menu sees the same
 * profile a terminal emulator would. Falls back to zsh on macOS and sh elsewhere.
 */
export function terminalShellFrom(source: TerminalShellSource): TerminalShell {
  const shell = source.shell?.trim();
  if (shell?.startsWith('/') === true) {
    return { file: shell, args: ['-l'] };
  }
  if (source.platform === 'darwin') {
    return { file: '/bin/zsh', args: ['-l'] };
  }
  return { file: '/bin/sh', args: [] };
}
