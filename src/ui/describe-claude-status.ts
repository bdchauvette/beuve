import type { ClaudeStatusView } from '#contract/ipc-contract.ts';

/** The Settings window's Claude row: a short status and the detail under it. */
export interface AccountLine {
  readonly tone: 'ok' | 'warn' | 'muted';
  readonly text: string;
  readonly detail: string;
}

const sources: Readonly<Record<string, string>> = {
  env: 'from BEUVE_CLAUDE_PATH',
  'known-location': 'from its install location',
  path: 'from PATH',
  configured: 'configured',
};

/**
 * `Claude Code 2.1.7` and where the CLI was found, or how to install it. Nothing here checks the
 * login (that would need a model call); the first question shows whether it works. Pure.
 */
export function describeClaudeStatus(status: ClaudeStatusView): AccountLine {
  if (status.kind === 'missing') {
    return { tone: 'warn', text: 'Claude Code not found', detail: status.message };
  }
  const where = `${status.command} (${sources[status.source] ?? status.source})`;
  return status.version === undefined
    ? { tone: 'muted', text: 'Claude Code found; it did not report a version', detail: where }
    : { tone: 'ok', text: status.version, detail: where };
}
