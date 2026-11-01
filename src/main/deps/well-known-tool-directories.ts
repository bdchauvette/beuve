import path from 'node:path';

/**
 * Where package managers and version managers put executables when the login shell can't say
 * (ADR 0089), searched after its `PATH`: Homebrew, `~/.local/bin` (uv, rv, mise, pipx), cargo,
 * bun, volta, the shims of mise, asdf, rbenv and pyenv, fnm's default alias, composer's global
 * bin, and Go's. uv-managed Pythons need no entry: uv finds its own.
 */
export function wellKnownToolDirectories(home: string): readonly string[] {
  const inHome = (...segments: readonly string[]): string => path.join(home, ...segments);
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    inHome('.local', 'bin'),
    inHome('.cargo', 'bin'),
    inHome('.bun', 'bin'),
    inHome('.volta', 'bin'),
    inHome('.local', 'share', 'mise', 'shims'),
    inHome('.asdf', 'shims'),
    inHome('.rbenv', 'shims'),
    inHome('.pyenv', 'shims'),
    inHome('.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    inHome('Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin'),
    inHome('.composer', 'vendor', 'bin'),
    inHome('.config', 'composer', 'vendor', 'bin'),
    inHome('go', 'bin'),
    '/usr/local/go/bin',
  ];
}
