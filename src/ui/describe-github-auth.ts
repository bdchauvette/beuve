import type { GithubAuthStatusView } from '#contract/ipc-contract.ts';

/** The status bar's GitHub sign-in segment. */
export interface GithubAuthLine {
  readonly tone: 'ok' | 'warn' | 'muted';
  readonly text: string;
  readonly title: string;
}

/**
 * `GitHub: @octocat via gh`, or what to do: `GitHub: not signed in — run gh auth login`. The
 * tooltip carries the host, the scopes or the full message. Pure.
 */
export function describeGithubAuth(auth: GithubAuthStatusView): GithubAuthLine {
  if (auth.kind === 'signed-in') {
    const who = auth.login === undefined ? 'signed in' : `@${auth.login}`;
    const scopes = auth.scopes === undefined ? '' : `\nScopes: ${auth.scopes.join(', ')}`;
    return {
      tone: auth.problem === undefined ? 'ok' : 'warn',
      text: `GitHub: ${who} via gh`,
      title: `${auth.host}${scopes}${auth.problem === undefined ? '' : `\n${auth.problem}`}`,
    };
  }
  switch (auth.reason) {
    case 'not-logged-in':
    case 'host-not-configured': {
      return {
        tone: 'warn',
        text: 'GitHub: not signed in — run gh auth login',
        title: auth.remedy === undefined ? auth.message : `Run: ${auth.remedy}`,
      };
    }
    case 'cli-not-installed': {
      return { tone: 'warn', text: 'GitHub: gh not installed', title: auth.message };
    }
    case 'invalid-host':
    case 'timeout':
    case 'command-failed': {
      return { tone: 'muted', text: 'GitHub: unavailable', title: auth.message };
    }
  }
}
