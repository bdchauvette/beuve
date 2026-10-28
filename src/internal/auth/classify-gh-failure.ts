import type { AuthError } from './auth-error.ts';
import { redactSecrets } from './redact-secrets.ts';

const loginHint = /no oauth token found|not logged in|gh auth login/i;

/**
 * The {@link AuthError} for a failed `gh auth token|status --hostname <host>`. gh 2.89 prints
 * `no oauth token found for <host>` whether the user never logged in or logged in to other hosts
 * only, so the host decides: `github.com` is `not-logged-in`, an Enterprise host
 * `host-not-configured`. Both carry `gh auth login --hostname <host>` as the remedy. Anything else
 * is `command-failed` with the last stderr line, token-shaped text redacted.
 */
export function classifyGhFailure(
  host: string,
  exitCode: number | undefined,
  stderr: string,
): AuthError {
  if (loginHint.test(stderr)) {
    const remedy = `gh auth login --hostname ${host}`;
    return host === 'github.com'
      ? { kind: 'not-logged-in', host, remedy }
      : { kind: 'host-not-configured', host, remedy };
  }
  const lines = stderr.split('\n').map((line) => line.trim());
  const last = lines.findLast((line) => line !== '') ?? `gh exited with ${String(exitCode)}`;
  return { kind: 'command-failed', exitCode, message: redactSecrets(last) };
}
