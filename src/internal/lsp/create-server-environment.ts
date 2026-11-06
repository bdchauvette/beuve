const inheritedNames = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
]);

/**
 * The environment a language server runs in: an allow-list of what programs need to find their
 * runtime, home and temp directories and locale, the variables named in `alsoInherit` (a server
 * definition's `inheritEnv`, such as `GOPATH`), plus `extra`. Everything else (tokens,
 * `NODE_OPTIONS`, `ELECTRON_*`, `GIT_*`) is dropped so the server can't be steered or read secrets
 * from beuve's env.
 */
export function createServerEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>> = {},
  alsoInherit: readonly string[] = [],
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    const upper = name.toUpperCase();
    const isAllowed =
      inheritedNames.has(upper) || upper.startsWith('LC_') || alsoInherit.includes(name);
    if (value !== undefined && isAllowed) {
      environment[name] = value;
    }
  }
  return { ...environment, ...extra };
}
