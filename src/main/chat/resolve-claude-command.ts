import path from 'node:path';

/** Where {@link resolveClaudeCommand} looks, injected so tests need no real files. */
export interface ClaudeCommandLookup {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
  /** Whether `file` is an existing regular file the user may execute. */
  readonly isExecutable: (file: string) => Promise<boolean>;
}

export type ClaudeCommand =
  | {
      readonly kind: 'found';
      readonly command: string;
      readonly source: 'env' | 'known-location' | 'path';
    }
  | { readonly kind: 'missing'; readonly message: string };

/** Names the `claude` executable explicitly. */
const claudePathVariable = 'BEUVE_CLAUDE_PATH';

/**
 * Finds the Claude Code CLI (ADR 0022). GUI apps on macOS start with a minimal `PATH`, so the
 * shell's lookup isn't enough: `BEUVE_CLAUDE_PATH` wins (and is not second-guessed: if it names no
 * executable the answer is `missing`), then the installers' usual locations
 * (`~/.claude/local/claude`, `~/.local/bin/claude`, `/opt/homebrew/bin/claude`,
 * `/usr/local/bin/claude`), then each absolute directory on `PATH`.
 */
export async function resolveClaudeCommand(lookup: ClaudeCommandLookup): Promise<ClaudeCommand> {
  const override = lookup.env[claudePathVariable]?.trim();
  if (override !== undefined && override !== '') {
    const file = expandHome(override, lookup.homeDirectory);
    return path.isAbsolute(file) && (await lookup.isExecutable(file))
      ? { kind: 'found', command: file, source: 'env' }
      : {
          kind: 'missing',
          message: `${claudePathVariable} is set to ${override}, which is not an executable file.`,
        };
  }
  const name = lookup.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const file of knownLocations(lookup.homeDirectory, lookup.platform)) {
    if (await lookup.isExecutable(file)) {
      return { kind: 'found', command: file, source: 'known-location' };
    }
  }
  const delimiter = lookup.platform === 'win32' ? ';' : ':';
  const directories = (lookup.env['PATH'] ?? '').split(delimiter);
  for (const directory of directories) {
    const file = path.join(directory, name);
    if (path.isAbsolute(directory) && (await lookup.isExecutable(file))) {
      return { kind: 'found', command: file, source: 'path' };
    }
  }
  return {
    kind: 'missing',
    message: `Claude Code (claude) was not found. Install it and log in, or set ${claudePathVariable} to its path.`,
  };
}

function expandHome(file: string, homeDirectory: string): string {
  return file === '~' || file.startsWith('~/') ? path.join(homeDirectory, file.slice(1)) : file;
}

function knownLocations(homeDirectory: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [path.join(homeDirectory, '.local', 'bin', 'claude.exe')];
  }
  return [
    path.join(homeDirectory, '.claude', 'local', 'claude'),
    path.join(homeDirectory, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
}
