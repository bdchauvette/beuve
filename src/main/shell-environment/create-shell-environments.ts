import type { Logger } from '#x/log/create-logger.ts';
import { errorFrom } from '#x/error/error-from.ts';
import type { ServerTrustDecision, ServerTrustRequest } from '#internal/lsp/check-server-trust.ts';

import type { ReadShellEnvironment } from './read-shell-environment.ts';
import type { ShellEnvironmentError } from './shell-environment-error.ts';

/** The environment the language servers of a checkout run in, and a note when it fell back. */
export interface ShellEnvironment {
  readonly variables: Readonly<Record<string, string | undefined>>;
  /** Plain text for the reviewer, when this is not the environment their shell would give. */
  readonly notice?: string;
}

/** The environments the reviewer's login shell gives (ADR 0111), asked once and remembered. */
export interface ShellEnvironments {
  /** The environment for a checkout: its own shell's, else the base one. Never rejects. */
  readonly forRoot: (root: string) => Promise<ShellEnvironment>;
  /** Forgets a checkout's environment, so the next `forRoot` asks the shell again. */
  readonly forget: (root: string) => void;
  /** The note about a checkout's environment, once `forRoot` has answered for it. */
  readonly noticeFor: (root: string) => string | undefined;
}

export interface ShellEnvironmentsOptions {
  /** beuve's own environment: what the shells start in, and what is used when they can't be read. */
  readonly processEnvironment: Readonly<Record<string, string | undefined>>;
  /** The reviewer's shell (`$SHELL`); none means there is nothing to ask. */
  readonly shell: string | undefined;
  /** Absolute path of a `node` that reads the environment back, when there is one. */
  readonly nodeCommand: string | undefined;
  readonly home: string;
  /** False when the environment is already complete: launched from a terminal, or on Windows. */
  readonly shouldRead: boolean;
  readonly read: ReadShellEnvironment;
  readonly trust: (request: ServerTrustRequest) => ServerTrustDecision;
  readonly logger: Logger;
  /** For each shell. Defaults to 10 s, as VS Code's. */
  readonly timeout?: Temporal.Duration;
}

const defaultTimeout = Temporal.Duration.from({ seconds: 10 });
const baseNotice =
  "Your shell's environment could not be read, so programs such as language servers are looked up in the environment beuve started with.";
const checkoutNotice =
  'The shell environment of this checkout could not be read, so the one from your home directory is used. If direnv or mise has not allowed this checkout, allow it in the terminal and restart the language servers.';

/**
 * Resolves the environment language servers run in the way IDEs do (ADR 0111): the reviewer's
 * login shell is asked once, at startup, from the home directory (the base), and again for each
 * checkout the first time its servers start, so per-directory tools such as direnv and mise take
 * effect there; their own trust decides what they load (ADR 0095), and the checkout read goes
 * through the trust check too. When a shell can't be read the servers fall back to the previous
 * environment and a notice says so. Nothing here rejects.
 */
export function createShellEnvironments(options: ShellEnvironmentsOptions): ShellEnvironments {
  const { logger } = options;
  const timeout = options.timeout ?? defaultTimeout;
  const processEnvironment: ShellEnvironment = { variables: options.processEnvironment };
  const { shell, nodeCommand } = options;
  const canAsk = options.shouldRead && shell !== undefined && nodeCommand !== undefined;
  const roots = new Map<string, Promise<ShellEnvironment>>();
  const resolved = new Map<string, ShellEnvironment>();

  const ask = async (cwd: string): Promise<Awaited<ReturnType<ReadShellEnvironment>>> => {
    return options.read({
      shell: shell ?? '',
      nodeCommand: nodeCommand ?? '',
      cwd,
      env: options.processEnvironment,
      timeout,
    });
  };

  const startBase = async (): Promise<ShellEnvironment> => {
    if (!options.shouldRead) {
      return processEnvironment;
    }
    if (!canAsk) {
      logger.warn('no shell or node to read the shell environment with');
      return { ...processEnvironment, notice: baseNotice };
    }
    const read = await ask(options.home);
    if (read.ok) {
      logger.info('read the shell environment', { variables: Object.keys(read.value).length });
      return { variables: read.value };
    }
    logger.warn('could not read the shell environment', { error: describeFailure(read.error) });
    return { ...processEnvironment, notice: baseNotice };
  };
  const readBase = async (): Promise<ShellEnvironment> => {
    try {
      return await startBase();
    } catch (error: unknown) {
      logger.warn('could not read the shell environment', { error: errorFrom(error).message });
      return { ...processEnvironment, notice: baseNotice };
    }
  };
  const base = readBase();

  const resolveRoot = async (root: string): Promise<ShellEnvironment> => {
    const fallback = await base;
    if (!canAsk || fallback.notice !== undefined) {
      return fallback;
    }
    const decision = options.trust({ kind: 'checkout-environment', root });
    if (!decision.allowed) {
      return { ...fallback, notice: decision.reason };
    }
    const read = await ask(root);
    if (read.ok) {
      logger.debug('read the shell environment of a checkout', {
        root,
        variables: Object.keys(read.value).length,
      });
      return { variables: read.value };
    }
    logger.warn('could not read the shell environment of a checkout', {
      error: describeFailure(read.error),
    });
    return { ...fallback, notice: checkoutNotice };
  };

  const resolveAndRemember = async (root: string): Promise<ShellEnvironment> => {
    const environment = await resolveRoot(root);
    resolved.set(root, environment);
    return environment;
  };

  return {
    forRoot: async (root): Promise<ShellEnvironment> => {
      let pending = roots.get(root);
      if (pending === undefined) {
        pending = resolveAndRemember(root);
        roots.set(root, pending);
      }
      return pending;
    },
    forget: (root): void => {
      roots.delete(root);
      resolved.delete(root);
    },
    noticeFor: (root): string | undefined => {
      return resolved.get(root)?.notice;
    },
  };
}

function describeFailure(error: ShellEnvironmentError): string {
  switch (error.kind) {
    case 'timed-out': {
      return `the shell did not answer within ${error.timeout.toString()}`;
    }
    case 'cancelled': {
      return 'cancelled';
    }
    case 'not-started': {
      return error.reason;
    }
    case 'failed': {
      return `the shell exited with ${String(error.code)}: ${error.stderr}`;
    }
    case 'unreadable': {
      return error.reason;
    }
  }
}
