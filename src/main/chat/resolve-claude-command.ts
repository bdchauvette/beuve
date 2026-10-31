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

/** The executable's name and `PATH`'s separator on each kind of platform. */
const platformConventions = {
  windows: { name: 'claude.exe', delimiter: ';' },
  posix: { name: 'claude', delimiter: ':' },
} as const;

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
    const file = expandHome({ file: override, homeDirectory: lookup.homeDirectory });
    if (path.isAbsolute(file) && (await lookup.isExecutable(file))) {
      return { kind: 'found', command: file, source: 'env' };
    }
    return {
      kind: 'missing',
      message: `${claudePathVariable} is set to ${override}, which is not an executable file.`,
    };
  }
  const { name, delimiter } = platformConventions[platformFamily(lookup.platform)];
  for (const file of knownLocations(lookup.homeDirectory, lookup.platform)) {
    if (await lookup.isExecutable(file)) {
      return { kind: 'found', command: file, source: 'known-location' };
    }
  }
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

function platformFamily(platform: NodeJS.Platform): 'windows' | 'posix' {
  if (platform === 'win32') {
    return 'windows';
  }
  return 'posix';
}

/** A path that may start with `~`, and the home directory that stands for. */
interface HomePath {
  readonly file: string;
  readonly homeDirectory: string;
}

function expandHome({ file, homeDirectory }: HomePath): string {
  if (file === '~' || file.startsWith('~/')) {
    return path.join(homeDirectory, file.slice(1));
  }
  return file;
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
