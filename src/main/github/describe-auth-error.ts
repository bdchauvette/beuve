import type { AuthError } from '#internal/auth/auth-error.ts';
import { formatDuration } from '#x/time/format-duration.ts';

/** One sentence for an {@link AuthError}, for status lines and failure messages. */
export function describeAuthError(error: AuthError, locale?: Intl.LocalesArgument): string {
  switch (error.kind) {
    case 'invalid-host': {
      return `${error.host} is not a GitHub hostname.`;
    }
    case 'cli-not-installed': {
      if (error.reason === undefined) {
        return 'The GitHub CLI (gh) is not installed. Install it, then run `gh auth login`.';
      }
      return `The GitHub CLI could not be found: ${error.reason}.`;
    }
    case 'not-logged-in': {
      return `Not signed in to ${error.host}. Run \`${error.remedy}\`.`;
    }
    case 'host-not-configured': {
      return `gh is not signed in to ${error.host}. Run \`${error.remedy}\`.`;
    }
    case 'timeout': {
      return `gh did not answer within ${formatDuration(error.timeout, locale)}.`;
    }
    case 'command-failed': {
      return `gh failed: ${error.message}`;
    }
  }
}
