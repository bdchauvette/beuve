import path from 'node:path';

/** Where the config can live, as the process knows them. */
export interface ConfigLocations {
  /** `$XDG_CONFIG_HOME`, when set and absolute. */
  readonly xdgConfigHome: string | undefined;
  readonly home: string;
  /** Electron's `userData`: on macOS `~/Library/Application Support/beuve`. */
  readonly userData: string;
}

const fileName = 'language-servers.json';

/**
 * The files `language-servers.json` is read from, earliest first (ADR 0111), as Ghostty reads its
 * config: the XDG location (`$XDG_CONFIG_HOME/beuve`, else `~/.config/beuve`) on every platform,
 * then the platform's own directory, `userData`, whose file wins where they differ. Neither need
 * exist. When both are the same file, it is listed once.
 */
export function languageServersConfigPaths(locations: ConfigLocations): string[] {
  let xdgRoot = path.join(locations.home, '.config');
  if (locations.xdgConfigHome !== undefined && path.isAbsolute(locations.xdgConfigHome)) {
    xdgRoot = locations.xdgConfigHome;
  }
  const xdg = path.join(xdgRoot, 'beuve', fileName);
  const own = path.join(locations.userData, fileName);
  if (xdg === own) {
    return [own];
  }
  return [xdg, own];
}
