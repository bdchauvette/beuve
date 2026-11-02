import type { LspServerView } from '#contract/ipc-contract.ts';

/** How the status bar shows the language servers: a dot, a short count, and a tooltip. */
export interface LspStatusLine {
  readonly tone: 'running' | 'starting' | 'muted';
  readonly text: string;
  readonly title: string;
}

/**
 * `Language servers: 2 running`, `… 1 starting` while any is coming up, or `none running` before
 * the first request starts one. A server being stopped counts as neither. Pure.
 */
export function describeLspStatus(servers: readonly LspServerView[]): LspStatusLine {
  const running = servers.filter((server) => server.state === 'running').length;
  const starting = servers.filter((server) => server.state === 'starting').length;
  const parts: string[] = [];
  if (running > 0) {
    parts.push(`${String(running)} running`);
  }
  if (starting > 0) {
    parts.push(`${String(starting)} starting`);
  }
  const title = 'Click for each language server beuve has started';
  if (parts.length === 0) {
    return { tone: 'muted', text: 'Language servers: none running', title };
  }
  let tone: LspStatusLine['tone'] = 'running';
  if (starting > 0) {
    tone = 'starting';
  }
  return { tone, text: `Language servers: ${parts.join(' · ')}`, title };
}
