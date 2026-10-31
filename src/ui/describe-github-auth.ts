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
    return signedIn(auth);
  }
  switch (auth.reason) {
    case 'not-logged-in':
    case 'host-not-configured': {
      return {
        tone: 'warn',
        text: 'GitHub: not signed in — run gh auth login',
        title: remedyOf(auth),
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

type SignedIn = Extract<GithubAuthStatusView, { kind: 'signed-in' }>;
type SignedOut = Extract<GithubAuthStatusView, { kind: 'signed-out' }>;

function signedIn(auth: SignedIn): GithubAuthLine {
  let who = 'signed in';
  if (auth.login !== undefined) {
    who = `@${auth.login}`;
  }
  const title = [auth.host];
  if (auth.scopes !== undefined) {
    title.push(`Scopes: ${auth.scopes.join(', ')}`);
  }
  const text = `GitHub: ${who} via gh`;
  if (auth.problem !== undefined) {
    title.push(auth.problem);
    return { tone: 'warn', text, title: title.join('\n') };
  }
  return { tone: 'ok', text, title: title.join('\n') };
}

function remedyOf(auth: SignedOut): string {
  if (auth.remedy === undefined) {
    return auth.message;
  }
  return `Run: ${auth.remedy}`;
}
