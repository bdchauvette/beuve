import type { GithubAuthStatusView } from '#contract/ipc-contract.ts';

/** What to do before posting to GitHub: sign in, or wait for the check. */
export function signInHintOf(auth: GithubAuthStatusView | undefined): string {
  if (auth?.kind !== 'signed-out') {
    return 'checking GitHub sign-in…';
  }
  if (auth.remedy === undefined) {
    return auth.message;
  }
  return `sign in first: run ${auth.remedy}.`;
}
