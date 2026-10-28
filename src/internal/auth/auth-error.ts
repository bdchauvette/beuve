/**
 * Why a GitHub credential couldn't be obtained (ADR 0034). Every variant is safe to show and log:
 * none carries a token. `remedy` is a command the user can run in a terminal.
 */
export type AuthError =
  | { readonly kind: 'invalid-host'; readonly host: string }
  | {
      readonly kind: 'cli-not-installed';
      /** The paths that were tried, in order. */
      readonly searched: readonly string[];
      /** Set when `BEUVE_GH_PATH` names something that isn't an executable file. */
      readonly reason?: string;
    }
  | { readonly kind: 'not-logged-in'; readonly host: string; readonly remedy: string }
  | { readonly kind: 'host-not-configured'; readonly host: string; readonly remedy: string }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | {
      readonly kind: 'command-failed';
      readonly exitCode: number | undefined;
      /** The last stderr line, with anything token-shaped redacted. */
      readonly message: string;
    };
