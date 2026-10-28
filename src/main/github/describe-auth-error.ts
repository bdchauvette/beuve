import type { AuthError } from '#internal/auth/auth-error.ts';

/** One sentence for an {@link AuthError}, for status lines and failure messages. */
export function describeAuthError(error: AuthError): string {
  switch (error.kind) {
    case 'invalid-host': {
      return `${error.host} is not a GitHub hostname.`;
    }
    case 'cli-not-installed': {
      return error.reason === undefined
        ? 'The GitHub CLI (gh) is not installed. Install it, then run `gh auth login`.'
        : `The GitHub CLI could not be found: ${error.reason}.`;
    }
    case 'not-logged-in': {
      return `Not signed in to ${error.host}. Run \`${error.remedy}\`.`;
    }
    case 'host-not-configured': {
      return `gh is not signed in to ${error.host}. Run \`${error.remedy}\`.`;
    }
    case 'timeout': {
      return `gh did not answer within ${String(Math.round(error.timeoutMs / 1000))} s.`;
    }
    case 'command-failed': {
      return `gh failed: ${error.message}`;
    }
  }
}
