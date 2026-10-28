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
  // Where Claude Code keeps its login and config, when the user moved it.
  'CLAUDE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  // Corporate networks: Claude Code must reach Anthropic the way the user's shell does.
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
]);

/**
 * The environment Claude Code runs in: what it needs to find itself, the user's own login
 * (`HOME`, `CLAUDE_CONFIG_DIR`) and the network, plus `extra`. Everything else is dropped: API keys
 * and provider switches (so the user's Claude Code login is what authenticates, unless main passes
 * them in `extra`), `CLAUDE_CODE_*` and `CLAUDECODE` from an enclosing Claude Code session,
 * `NODE_OPTIONS`, `ELECTRON_*`, `GIT_*` and tokens.
 */
export function createClaudeCodeEnvironment(
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
  return { ...environment, ...extra };
}
