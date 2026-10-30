import type { GithubAuthStatusView } from '#contract/ipc-contract.ts';
import type { AuthError } from '#internal/auth/auth-error.ts';
import type { CredentialDescription } from '#internal/auth/github-credential-provider.ts';
import type { Result } from '#x/result/result.ts';

import { describeAuthError } from './describe-auth-error.ts';

/**
 * The credential provider's `describe()` as the status bar shows it: who, via what, and for a
 * missing credential why and the command that fixes it. Carries no secret. Pure.
 */
export function describeAuthStatus(
  host: string,
  described: Result<CredentialDescription, AuthError>,
  locale?: Intl.LocalesArgument,
): GithubAuthStatusView {
  if (described.ok) {
    const { account } = described.value;
    return {
      kind: 'signed-in',
      host,
      provider: described.value.provider,
      ...(account !== undefined && { login: account.login }),
      ...(account?.scopes !== undefined && { scopes: account.scopes }),
      ...(account?.check.kind === 'failed' && { problem: account.check.message }),
    };
  }
  const { error } = described;
  return {
    kind: 'signed-out',
    host,
    reason: error.kind,
    message: describeAuthError(error, locale),
    ...('remedy' in error && { remedy: error.remedy }),
  };
}
