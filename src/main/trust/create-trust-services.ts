import type {
  IpcError,
  IpcResult,
  TrustEntryView,
  TrustGetRequest,
  TrustRemoveRequest,
  TrustSetRequest,
  TrustView,
} from '#contract/ipc-contract.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import type { RepositoryTrust } from './create-repository-trust.ts';

/** A grant given or withdrawn from a session (the prompt, the command or `/trust`). */
export interface TrustChange {
  readonly sessionId: string;
  readonly trusted: boolean;
}

/**
 * The one trust grant as the renderer reaches it (ADR 0090): `trust:get` and `trust:set` for an
 * open session's repository, `trust:list` and `trust:remove` for the Settings window. Only
 * renderer channels write it; nothing a model or an MCP client sends can.
 */
export interface TrustServices {
  readonly get: (request: TrustGetRequest) => Promise<IpcResult<TrustView>>;
  readonly set: (request: TrustSetRequest) => Promise<IpcResult<TrustView>>;
  readonly list: () => Promise<IpcResult<readonly TrustEntryView[]>>;
  readonly remove: (request: TrustRemoveRequest) => Promise<IpcResult<readonly TrustEntryView[]>>;
  /** Called after a session's grant changed, so installs can start (ADR 0089). */
  readonly onChanged: (listener: (change: TrustChange) => void) => () => void;
}

export interface TrustServicesOptions {
  readonly context: SessionContext;
  readonly trust: RepositoryTrust;
}

export function createTrustServices({ context, trust }: TrustServicesOptions): TrustServices {
  const listeners = new Set<(change: TrustChange) => void>();

  const repositoryOf = async (sessionId: string): Promise<Result<GitRepository, IpcError>> => {
    const loaded = loadSession(context, sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const refreshed = await refreshSession(context, loaded.value);
    if (!refreshed.ok) {
      return refreshed;
    }
    return ok(refreshed.value.repository);
  };

  const notify = (change: TrustChange): void => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (error: unknown) {
        context.logger.warn('trust listener failed', { error });
      }
    }
  };

  return {
    get: async ({ sessionId }): Promise<IpcResult<TrustView>> => {
      const repository = await repositoryOf(sessionId);
      if (!repository.ok) {
        return repository;
      }
      return ok(await trust.status(repository.value));
    },
    set: async ({ sessionId, trusted }): Promise<IpcResult<TrustView>> => {
      const repository = await repositoryOf(sessionId);
      if (!repository.ok) {
        return repository;
      }
      let changed: TrustView;
      if (trusted) {
        changed = await trust.grant(repository.value);
      } else {
        changed = await trust.revoke(repository.value);
      }
      notify({ sessionId, trusted: changed.trusted });
      return ok(changed);
    },
    list: async (): Promise<IpcResult<readonly TrustEntryView[]>> => {
      return ok(await trust.list());
    },
    remove: async ({ repositoryPath }): Promise<IpcResult<readonly TrustEntryView[]>> => {
      return ok(await trust.remove(repositoryPath));
    },
    onChanged: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
