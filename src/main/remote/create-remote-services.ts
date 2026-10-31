import type { IpcResult, PermalinkRequest, PermalinkView } from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { GithubRemote } from '#internal/github/parse-github-remote-url.ts';
import { permalinkFrom } from '#internal/github/permalink-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { resolveSheetCommit } from '../sheets/resolve-sheet-commit.ts';

import { choosePrimaryRemote } from './choose-primary-remote.ts';

/** Permalinks to the primary remote (ADR 0067). */
export interface RemoteServices {
  readonly permalink: (request: PermalinkRequest) => Promise<IpcResult<PermalinkView>>;
  /** Builds the link the same way and opens it in the browser; the renderer never names a URL. */
  readonly openPermalink: (request: PermalinkRequest) => Promise<IpcResult<PermalinkView>>;
}

export interface RemoteServicesOptions {
  readonly context: SessionContext;
  /** The system browser; absent outside Electron, where opening answers `not-wired`. */
  readonly openExternal?: (url: string) => Promise<void>;
}

/**
 * `remote:permalink` picks the primary remote (the pull request's base repository, else
 * `origin`, else the first GitHub remote) and links `path` at the full `sha` there. Whether the
 * remote has the commit isn't checked: an unpushed commit's link answers 404 on GitHub until it is
 * pushed. `remote:open-permalink`
 * opens that link, which is https to the remote's own host by construction.
 */
export function createRemoteServices(options: RemoteServicesOptions): RemoteServices {
  const { context } = options;
  const permalink = async (request: PermalinkRequest): Promise<IpcResult<PermalinkView>> => {
    const commit = await resolveSheetCommit(context, request);
    if (!commit.ok) {
      return commit;
    }
    const { repository, session } = commit.value.refreshed;
    const remotes = await listRemoteUrls(repository);
    if (!remotes.ok) {
      return gitFailure(context.logger, remotes.error);
    }
    const { source } = session;
    let pullRequestBase: GithubRemote | undefined;
    if (source.kind === 'github-pull-request') {
      pullRequestBase = { host: source.host, owner: source.owner, repo: source.repo };
    }
    const remote = choosePrimaryRemote(remotes.value, pullRequestBase);
    if (remote === undefined) {
      return ok({ kind: 'no-remote' });
    }
    return ok({
      kind: 'link',
      remote: remote.name,
      url: permalinkFrom({
        ...remote.repository,
        sha: commit.value.sha,
        path: request.path,
        ...(request.startLine !== undefined && { startLine: request.startLine }),
        ...(request.endLine !== undefined && { endLine: request.endLine }),
      }),
    });
  };
  return {
    permalink,
    openPermalink: async (request): Promise<IpcResult<PermalinkView>> => {
      if (options.openExternal === undefined) {
        return err({ code: 'not-wired', message: 'no browser outside Electron' });
      }
      const link = await permalink(request);
      if (link.ok && link.value.kind === 'link') {
        await options.openExternal(link.value.url);
      }
      return link;
    },
  };
}
