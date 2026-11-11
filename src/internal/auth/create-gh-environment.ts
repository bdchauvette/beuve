const inheritedNames = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  // Where gh keeps its config and hosts.yml, when the user moved it.
  'GH_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  // The Linux secret service (gh's keyring) is reached over the session bus.
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  // `gh auth status` checks the token against the API, the way the user's shell reaches it.
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SYSTEMROOT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
]);

const fixed: Readonly<Record<string, string>> = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
  GH_SPINNER_DISABLED: '1',
  NO_COLOR: '1',
  CLICOLOR: '0',
};

/**
 * The environment `gh` runs in: what it needs to find its stored login (`HOME`, `GH_CONFIG_DIR`,
 * XDG and keyring variables) and the network, with prompts, color and update checks off. Token
 * variables (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, …) and `GH_HOST` are dropped, so
 * the answer is always the login `gh auth login` stored, never whatever the launching shell held.
 */
export function createGhEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    const upper = name.toUpperCase();
    if (value !== undefined && (inheritedNames.has(upper) || upper.startsWith('LC_'))) {
      environment[name] = value;
    }
  }
  return { ...environment, ...fixed };
}
