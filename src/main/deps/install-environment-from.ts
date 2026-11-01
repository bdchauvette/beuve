/** Where an install's environment comes from. */
export interface InstallEnvironmentSources {
  /** beuve's own environment: only allow-listed names pass. */
  readonly inherited: Readonly<Record<string, string | undefined>>;
  /** The login shell's tool variables (`MISE_*`, `VOLTA_HOME`, …), `PATH` aside. */
  readonly login: Readonly<Record<string, string>>;
  /** beuve's own: the documented hook variables and `COREPACK_HOME`. */
  readonly beuve: Readonly<Record<string, string>>;
}

const inheritedNames = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'PIP_CERT',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'SSH_AUTH_SOCK',
]);

/**
 * The environment every install step starts from (ADR 0089): the allow-listed part of beuve's
 * own (home, locale, temp, proxy and CA variables, so registries behind a proxy and private
 * certificates work, and the SSH agent for git dependencies), the login shell's tool variables,
 * beuve's variables, and the non-interactive flags package managers honour. Tokens in beuve's
 * environment are not passed; the user's own `~/.npmrc` and similar files still are, through
 * `HOME`. `PATH` comes from toolchain discovery, per tool.
 */
export function installEnvironmentFrom({
  inherited,
  login,
  beuve,
}: InstallEnvironmentSources): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    const upper = name.toUpperCase();
    if (value !== undefined && (inheritedNames.has(upper) || upper.startsWith('LC_'))) {
      environment[name] = value;
    }
  }
  return {
    ...environment,
    ...login,
    ...beuve,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}
