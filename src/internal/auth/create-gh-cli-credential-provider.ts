import os from 'node:os';
import process from 'node:process';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { AuthError } from './auth-error.ts';
import { classifyGhFailure } from './classify-gh-failure.ts';
import { createGhEnvironment } from './create-gh-environment.ts';
import type {
  CredentialDescription,
  CredentialRequest,
  GithubCredentialProvider,
} from './github-credential-provider.ts';
import { GithubToken } from './github-token.ts';
import { normalizeHostname } from '#x/net/normalize-hostname.ts';
import { parseGhAuthStatus } from './parse-gh-auth-status.ts';
import { resolveGhCommand } from './resolve-gh-command.ts';
import type { ResolveGhCommandOptions } from './resolve-gh-command.ts';
import { runGh } from './run-gh.ts';
import type { GhExit } from './run-gh.ts';

export interface GhCliCredentialProviderOptions {
  /** An absolute `gh` path. When omitted it is resolved (and remembered) with `resolveGhCommand`. */
  readonly command?: string;
  /** Before gh's own arguments, e.g. a script when `command` is a Node binary (tests). */
  readonly leadingArgs?: readonly string[];
  readonly resolve?: ResolveGhCommandOptions;
  /** Where the allow-listed environment is taken from. Defaults to `process.env`. */
  readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
  /** gh's working directory. Defaults to `os.homedir()`, never a repository under review. */
  readonly cwd?: string;
  /** For `gh auth token`, which reads local config or the keyring. Defaults to 10 s. */
  readonly timeout?: Temporal.Duration;
  /** For `gh auth status`, which checks the token against the API. Defaults to 15 s. */
  readonly statusTimeout?: Temporal.Duration;
  readonly logger?: Logger;
}

/**
 * A {@link GithubCredentialProvider} that reuses the GitHub CLI's login (ADR 0034): `getToken` runs
 * `gh auth token --hostname <host>`, `describe` runs `gh auth status --hostname <host> --json hosts`
 * (falling back to no account details on a gh without `--json`). No shell, an allow-listed
 * environment without token variables, a timeout, stdin closed. Nothing is cached here (wrap it in
 * `createCachedCredentialProvider`), nothing is stored, and the token is never logged.
 */
export function createGhCliCredentialProvider(
  options: GhCliCredentialProviderOptions = {},
): GithubCredentialProvider {
  let resolved: string | undefined = options.command;

  const run = async (
    args: readonly string[],
    timeout: Temporal.Duration,
  ): Promise<Result<GhExit, AuthError>> => {
    if (resolved === undefined) {
      const found = await resolveGhCommand(options.resolve);
      if (!found.ok) {
        return found;
      }
      resolved = found.value;
    }
    const command = resolved;
    const stopwatch = new Stopwatch();
    const outcome = await runGh({
      command,
      ...(options.leadingArgs !== undefined && { leadingArgs: options.leadingArgs }),
      args,
      env: createGhEnvironment(options.inheritedEnv ?? process.env),
      cwd: options.cwd ?? os.homedir(),
      timeout,
    });
    options.logger?.debug('gh: finished', {
      subcommand: args.slice(0, 2).join(' '),
      duration: stopwatch.elapsed(),
      outcome: outcome.ok ? outcome.value.exitCode : outcome.error.kind,
    });
    if (outcome.ok) {
      return outcome;
    }
    switch (outcome.error.kind) {
      case 'not-found': {
        if (options.command === undefined) {
          resolved = undefined;
        }
        return err({ kind: 'cli-not-installed', searched: [command] });
      }
      case 'timeout': {
        return err({ kind: 'timeout', timeout });
      }
      case 'output-too-large': {
        return err({ kind: 'command-failed', exitCode: undefined, message: 'gh wrote too much' });
      }
      case 'spawn-failed': {
        return err({ kind: 'command-failed', exitCode: undefined, message: outcome.error.message });
      }
    }
  };

  const getToken = async ({ host }: CredentialRequest): Promise<Result<GithubToken, AuthError>> => {
    const normalized = normalizeHostname(host);
    if (normalized === undefined) {
      return err({ kind: 'invalid-host', host });
    }
    const exit = await run(
      ['auth', 'token', '--hostname', normalized],
      options.timeout ?? Temporal.Duration.from({ seconds: 10 }),
    );
    if (!exit.ok) {
      return exit;
    }
    const { exitCode, stdout, stderr } = exit.value;
    if (exitCode !== 0) {
      return err(classifyGhFailure(normalized, exitCode, stderr));
    }
    const parsed = GithubToken.parse(stdout);
    return parsed === undefined
      ? err({ kind: 'command-failed', exitCode, message: 'gh printed no usable token' })
      : ok(parsed);
  };

  const describe = async ({
    host,
  }: CredentialRequest): Promise<Result<CredentialDescription, AuthError>> => {
    const normalized = normalizeHostname(host);
    if (normalized === undefined) {
      return err({ kind: 'invalid-host', host });
    }
    const exit = await run(
      ['auth', 'status', '--hostname', normalized, '--json', 'hosts'],
      options.statusTimeout ?? Temporal.Duration.from({ seconds: 15 }),
    );
    if (!exit.ok) {
      return exit;
    }
    const { exitCode, stdout, stderr } = exit.value;
    if (exitCode !== 0) {
      return stderr.includes('unknown flag: --json')
        ? ok({ provider: 'gh-cli', host: normalized, account: undefined })
        : err(classifyGhFailure(normalized, exitCode, stderr));
    }
    const account = parseGhAuthStatus(stdout, normalized);
    if (account === 'invalid') {
      return ok({ provider: 'gh-cli', host: normalized, account: undefined });
    }
    if (account === undefined) {
      return err(classifyGhFailure(normalized, exitCode, 'no oauth token found'));
    }
    return ok({ provider: 'gh-cli', host: normalized, account });
  };

  return {
    getToken,
    describe,
    invalidate: (): void => {
      // Nothing is cached: every getToken asks gh afresh.
    },
  };
}
