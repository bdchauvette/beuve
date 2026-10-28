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
  'TZ',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
]);

/**
 * The environment the test run gets (ADR 0036): the allow-list language servers get (ADR 0017)
 * plus `TZ`, then `extra`, then `CI=1` (Vitest then never writes new snapshots) and no colours.
 * Tokens, `NODE_OPTIONS`, `ELECTRON_*` (unless in `extra`) and `GIT_*` are dropped.
 */
export function createTraceEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    const upper = name.toUpperCase();
    if (value !== undefined && (inheritedNames.has(upper) || upper.startsWith('LC_'))) {
      environment[name] = value;
    }
  }
  return { ...environment, ...extra, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
}
