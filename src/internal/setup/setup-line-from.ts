import path from 'node:path';

/** What {@link setupLineFrom} builds a line from. */
export interface SetupLineRequest {
  /** A command `parseSetupCommand` accepted. */
  readonly command: string;
  /** The shell's program, which decides how the command is grouped. */
  readonly shell: string;
  /** Hex digits that make this run's marker unguessable to the command it runs. */
  readonly nonce: string;
}

/** The keystrokes to type into the shell, and the output that says the command succeeded. */
export interface SetupLine {
  /** One line, ending in a carriage return as Enter would. */
  readonly text: string;
  /** An OSC sequence no terminal assigns, which xterm ignores; the shell prints it on success. */
  readonly marker: string;
}

/** Not a number any terminal uses, so xterm drops it unseen. */
const oscNumber = '7703';

/**
 * The line beuve types into the reviewer's shell for Run Setup (ADR 0130): the command in a group,
 * then, only when the group succeeds, a `printf` of the run's marker. The marker is written in the
 * line as octal escapes (`\033`, `\007`), so the shell's echo of the line never contains it; only
 * `printf`'s output does. fish groups with `begin; …; end; and`, every other shell with
 * `{ …; } &&`.
 */
export function setupLineFrom(request: SetupLineRequest): SetupLine {
  const payload = `]${oscNumber};beuve-setup;${request.nonce}`;
  const printf = String.raw`printf '\033${payload}\007'`;
  let text = `{ ${request.command}; } && ${printf}`;
  if (path.basename(request.shell) === 'fish') {
    text = `begin; ${request.command}; end; and ${printf}`;
  }
  return { text: `${text}\r`, marker: `\u{1B}${payload}\u{7}` };
}
