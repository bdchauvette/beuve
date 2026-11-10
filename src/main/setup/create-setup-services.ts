import type {
  IpcError,
  IpcResult,
  SetupCommandView,
  SetupFinishedEvent,
  SetupRunRequest,
  SetupSetCommandRequest,
  SetupStatusRequest,
  SetupStatusView,
  TerminalView,
} from '#contract/ipc-contract.ts';
import { findTreeBlob } from '#internal/git/find-tree-blob.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { Session } from '#internal/session/session.ts';
import { findSetupCommand } from '#internal/setup/find-setup-command.ts';
import { findSetupRun } from '#internal/setup/find-setup-run.ts';
import { forgetSetupRuns } from '#internal/setup/forget-setup-runs.ts';
import { parseSetupCommand } from '#internal/setup/parse-setup-command.ts';
import { recordSetupRun } from '#internal/setup/record-setup-run.ts';
import { saveSetupCommand } from '#internal/setup/save-setup-command.ts';
import { setupHints } from '#internal/setup/setup-hints.ts';
import { setupLineFrom } from '#internal/setup/setup-line-from.ts';
import { SetupMarkerWatcher } from '#internal/setup/setup-marker-watcher.ts';
import type { SetupStoreError } from '#internal/setup/setup-record.ts';
import { suggestSetupCommand } from '#internal/setup/suggest-setup-command.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err, Result } from '#x/result/result.ts';

import { choosePrimaryRemote } from '../remote/choose-primary-remote.ts';
import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadSession } from '../sessions/load-session.ts';
import { openSessionRepository } from '../sessions/open-session-repository.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type {
  ScriptedTerminalRun,
  ScriptedTerminalStart,
  TerminalServices,
} from '../terminal/create-terminal-services.ts';

/**
 * Run Setup (ADR 0130): the reviewer's own setup command per repository, stored in beuve's
 * database, typed into a new terminal in the checkout of the session's head when the reviewer
 * asks. Nothing here runs on its own.
 */
export interface SetupServices {
  /** The repository's command, a suggestion, and whether this head's checkout is set up. */
  readonly status: (
    request: SetupStatusRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<SetupStatusView>>;
  /** Stores the command for the session's repository, after `parseSetupCommand`. */
  readonly setCommand: (
    request: SetupSetCommandRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<SetupCommandView>>;
  /** Opens a terminal at the session's head and types the stored command into it. */
  readonly run: (
    request: SetupRunRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<TerminalView>>;
  readonly onFinished: (listener: (event: SetupFinishedEvent) => void) => () => void;
  /** A checkout was checked out afresh or removed: what a setup wrote there is gone. */
  readonly forgetCheckout: (checkout: string) => void;
}

export interface SetupServicesOptions {
  readonly context: SessionContext;
  readonly terminal: TerminalServices;
}

/** The title of a setup's terminal tab. */
const setupTitle = 'setup';

export function createSetupServices(options: SetupServicesOptions): SetupServices {
  const { context, terminal } = options;
  const { db, logger } = context;
  const finishedListeners = new Set<(event: SetupFinishedEvent) => void>();

  const finish = (start: ScriptedTerminalStart): void => {
    try {
      recordSetupRun(db, {
        sessionId: start.sessionId,
        headSha: start.headSha,
        checkout: start.checkout,
      });
    } catch (error) {
      // The session was deleted while its setup ran: there is nothing left to remember it for.
      logger.warn('setup: could not record the run', { error: errorFrom(error).message });
      return;
    }
    const event = {
      sessionId: start.sessionId,
      headSha: start.headSha,
      terminalId: start.terminalId,
    };
    for (const listener of finishedListeners) {
      listener(event);
    }
  };

  const scriptFor = (command: string): ((start: ScriptedTerminalStart) => ScriptedTerminalRun) => {
    const nonce = crypto.getRandomValues(new Uint8Array(12)).toHex();
    return (start) => {
      const line = setupLineFrom({ command, shell: start.shell, nonce });
      const watcher = new SetupMarkerWatcher(line.marker);
      return {
        input: line.text,
        onOutput: (text): void => {
          if (watcher.write(text)) {
            finish(start);
          }
        },
      };
    };
  };

  return {
    status: async (request, requestOptions = {}): Promise<IpcResult<SetupStatusView>> => {
      const { signal } = requestOptions;
      const opened = await openAtHead(context, request, signal);
      if (!opened.ok) {
        return opened;
      }
      const { session, repository } = opened.value;
      const key = await repositoryKeyOf({ context, session, repository });
      if (!key.ok) {
        return key;
      }
      const { headSha } = session;
      if (key.value === undefined) {
        return ok({ kind: 'no-remote', sessionId: session.id, headSha });
      }
      const stored = findSetupCommand(db, key.value);
      if (!stored.ok) {
        return storeFailure(context, stored.error);
      }
      const lastRun = findSetupRun(db, session.id);
      if (!lastRun.ok) {
        return storeFailure(context, lastRun.error);
      }
      const present = await presentHintFiles(context, { session, repository });
      if (!present.ok) {
        return present;
      }
      return ok({
        kind: 'ready',
        sessionId: session.id,
        headSha,
        repository: key.value,
        ...(stored.value !== undefined && { command: stored.value.command }),
        suggestion: suggestSetupCommand(present.value),
        isSetUp: lastRun.value?.headSha === headSha,
      });
    },
    setCommand: async (request, requestOptions = {}): Promise<IpcResult<SetupCommandView>> => {
      const command = parseSetupCommand(request.command);
      if (!command.ok) {
        return err({ code: 'invalid-request', message: command.error.message });
      }
      const loaded = loadSession(context, request.sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const session = loaded.value;
      const repository = await openSessionRepository(
        context,
        session.source.repoPath,
        requestOptions.signal,
      );
      if (!repository.ok) {
        return gitFailure(logger, repository.error);
      }
      const key = await repositoryKeyOf({ context, session, repository: repository.value });
      if (!key.ok) {
        return key;
      }
      if (key.value === undefined) {
        return err(noRemote());
      }
      const saved = saveSetupCommand(db, { repository: key.value, command: command.value });
      return ok({ repository: saved.repository, command: saved.command });
    },
    run: async (request, requestOptions = {}): Promise<IpcResult<TerminalView>> => {
      const { signal } = requestOptions;
      const opened = await openAtHead(context, request, signal);
      if (!opened.ok) {
        return opened;
      }
      const key = await repositoryKeyOf({ context, ...opened.value });
      if (!key.ok) {
        return key;
      }
      if (key.value === undefined) {
        return err(noRemote());
      }
      const stored = findSetupCommand(db, key.value);
      if (!stored.ok) {
        return storeFailure(context, stored.error);
      }
      if (stored.value === undefined) {
        return err({ code: 'refused', message: 'This repository has no setup command yet.' });
      }
      return terminal.openScripted(
        { ...request, title: setupTitle, script: scriptFor(stored.value.command) },
        { signal },
      );
    },
    onFinished: (listener): (() => void) => {
      finishedListeners.add(listener);
      return (): void => {
        finishedListeners.delete(listener);
      };
    },
    forgetCheckout: (checkout): void => {
      forgetSetupRuns(db, checkout);
    },
  };
}

/** A session at the head the request expects, and its repository opened for the request. */
interface SessionAtHead {
  readonly session: Session;
  readonly repository: GitRepository;
}

/** What `repositoryKeyOf` reads the key from. */
interface KeySource extends SessionAtHead {
  readonly context: SessionContext;
}

async function openAtHead(
  context: SessionContext,
  request: SetupStatusRequest,
  signal: AbortSignal | undefined,
): Promise<Result<SessionAtHead, IpcError>> {
  const loaded = loadSession(context, request.sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const session = loaded.value;
  if (session.headSha !== request.expectedHeadSha) {
    return err({ code: 'stale-review', message: 'The head moved; showing the new commits.' });
  }
  const repository = await openSessionRepository(context, session.source.repoPath, signal);
  if (!repository.ok) {
    return gitFailure(context.logger, repository.error);
  }
  return ok({ session, repository: repository.value });
}

/**
 * The repository a setup command is stored under (ADR 0130): `host/owner/repo` in lowercase, as
 * the review queue matches sessions (ADR 0113). A pull request or remote-branch session names it;
 * a local session takes the remote permalinks use (`origin`, else the first GitHub-style remote).
 * `undefined` for a local repository without one.
 */
async function repositoryKeyOf(source: KeySource): Promise<Result<string | undefined, IpcError>> {
  const { session, repository, context } = source;
  const sessionSource = session.source;
  if (sessionSource.kind !== 'local') {
    return ok(keyFrom(sessionSource));
  }
  const remotes = await listRemoteUrls(repository);
  if (!remotes.ok) {
    return gitFailure(context.logger, remotes.error);
  }
  const primary = choosePrimaryRemote(remotes.value);
  if (primary === undefined) {
    return ok(undefined);
  }
  return ok(keyFrom(primary.repository));
}

/** A repository's `host`, `owner` and `repo`. */
interface RepositoryName {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

function keyFrom(name: RepositoryName): string {
  return `${name.host}/${name.owner}/${name.repo}`.toLowerCase();
}

/** Which of the hint files are at the top of the head's tree, each one object read (ADR 0087). */
async function presentHintFiles(
  context: SessionContext,
  { session, repository }: SessionAtHead,
): Promise<Result<ReadonlySet<string>, IpcError>> {
  const present = new Set<string>();
  for (const hint of setupHints) {
    const found = await findTreeBlob(repository, session.headSha, hint.file);
    if (!found.ok) {
      return gitFailure(context.logger, found.error);
    }
    if (found.value !== undefined) {
      present.add(hint.file);
    }
  }
  return ok(present);
}

function storeFailure(context: SessionContext, error: SetupStoreError): Err<IpcError> {
  context.logger.error('setup: corrupt row', { error });
  return err({ code: 'internal', message: 'beuve could not read its setup commands.' });
}

function noRemote(): IpcError {
  return {
    code: 'refused',
    message: 'Run Setup needs a GitHub-style remote: its command is stored per repository.',
  };
}
