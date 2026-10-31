import { z } from 'zod';

import type { CredentialAccount } from './github-credential-provider.ts';
import { redactSecrets } from './redact-secrets.ts';

/** One account entry of `gh auth status --json hosts` (gh 2.89); other keys are dropped. */
const accountSchema = z.object({
  state: z.string(),
  active: z.boolean(),
  host: z.string(),
  login: z.string().optional(),
  scopes: z.string().optional(),
  error: z.string().optional(),
});

const statusSchema = z.object({ hosts: z.record(z.string(), z.array(accountSchema)) });

type StatusAccount = z.infer<typeof accountSchema>;

/** What `gh auth status --hostname <host> --json hosts` printed, and the host it asked about. */
export interface GhAuthStatusOutput {
  readonly stdout: string;
  readonly host: string;
}

/**
 * The active account for `host` in `gh auth status --json hosts` output: `undefined` when gh lists
 * no account there, `'invalid'` when the output isn't the documented shape. `scopes` is gh's
 * comma-separated list; gh omits it for fine-grained tokens and when its check failed.
 */
export function parseGhAuthStatus({
  stdout,
  host,
}: GhAuthStatusOutput): CredentialAccount | undefined | 'invalid' {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return 'invalid';
  }
  const parsed = statusSchema.safeParse(json);
  if (!parsed.success) {
    return 'invalid';
  }
  const accounts = parsed.data.hosts[host] ?? [];
  const account = accounts.find((entry) => entry.active) ?? accounts[0];
  if (account?.login === undefined) {
    return undefined;
  }
  const scopes = account.scopes
    ?.split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '');
  return {
    login: account.login,
    scopes,
    check: checkFrom(account),
  };
}

function checkFrom(account: StatusAccount): CredentialAccount['check'] {
  if (account.state === 'success') {
    return { kind: 'valid' };
  }
  return { kind: 'failed', message: redactSecrets(account.error ?? account.state) };
}
