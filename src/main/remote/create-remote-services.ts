import type {
  CommitLinkRequest,
  IpcError,
  IpcResult,
  PermalinkRequest,
  PermalinkView,
} from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import { commitLinkFrom } from '#internal/github/commit-link-from.ts';
import type { GithubRemote } from '#internal/github/parse-github-remote-url.ts';
import { permalinkFrom } from '#internal/github/permalink-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import type { RefreshedSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { resolveSheetCommit } from '../sheets/resolve-sheet-commit.ts';

import { choosePrimaryRemote } from './choose-primary-remote.ts';
import type { PrimaryRemote } from './choose-primary-remote.ts';

/** Links to the primary remote (ADR 0067, 0106). */
export interface RemoteServices {
  readonly permalink: (request: PermalinkRequest) => Promise<IpcResult<PermalinkView>>;
  /** Builds the link the same way and opens it in the browser; the renderer never names a URL. */
  readonly openPermalink: (request: PermalinkRequest) => Promise<IpcResult<PermalinkView>>;
  /** Opens a commit's page on the primary remote; the renderer names the commit, not a URL. */
  readonly openCommit: (request: CommitLinkRequest) => Promise<IpcResult<PermalinkView>>;
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
 * pushed. `remote:open-permalink` opens that link, and `remote:open-commit` opens the commit's own
 * page, both https to the remote's own host by construction.
 */
export function createRemoteServices(options: RemoteServicesOptions): RemoteServices {
  const { context } = options;
  const permalink = async (request: PermalinkRequest): Promise<IpcResult<PermalinkView>> => {
    return linkTo(context, request, ({ remote, sha }) => {
      return permalinkFrom({
        ...remote.repository,
        sha,
        path: request.path,
        ...(request.startLine !== undefined && { startLine: request.startLine }),
        ...(request.endLine !== undefined && { endLine: request.endLine }),
      });
    });
  };
  const commit = async (request: CommitLinkRequest): Promise<IpcResult<PermalinkView>> => {
    return linkTo(context, request, ({ remote, sha }) => {
      return commitLinkFrom({ ...remote.repository, sha });
    });
  };
  const open = async (link: IpcResult<PermalinkView>): Promise<IpcResult<PermalinkView>> => {
    if (options.openExternal === undefined) {
      return err({ code: 'not-wired', message: 'no browser outside Electron' });
    }
    if (link.ok && link.value.kind === 'link') {
      await options.openExternal(link.value.url);
    }
    return link;
  };
  return {
    permalink,
    openPermalink: async (request): Promise<IpcResult<PermalinkView>> => {
      return open(await permalink(request));
    },
    openCommit: async (request): Promise<IpcResult<PermalinkView>> => {
      return open(await commit(request));
    },
  };
}

/** A resolved commit and the remote a link to it points at. */
interface LinkSubject {
  readonly remote: PrimaryRemote;
  readonly sha: CommitSha;
}

/** Checks the commit, picks the primary remote, and builds the link; `no-remote` without one. */
async function linkTo(
  context: SessionContext,
  request: CommitLinkRequest,
  build: (subject: LinkSubject) => string,
): Promise<IpcResult<PermalinkView>> {
  const commit = await resolveSheetCommit(context, request);
  if (!commit.ok) {
    return commit;
  }
  const remote = await primaryRemoteOf(context, commit.value.refreshed);
  if (!remote.ok) {
    return remote;
  }
  if (remote.value === undefined) {
    return ok({ kind: 'no-remote' });
  }
  return ok({
    kind: 'link',
    remote: remote.value.name,
    url: build({ remote: remote.value, sha: commit.value.sha }),
  });
}

async function primaryRemoteOf(
  context: SessionContext,
  { repository, session }: RefreshedSession,
): Promise<Result<PrimaryRemote | undefined, IpcError>> {
  const remotes = await listRemoteUrls(repository);
  if (!remotes.ok) {
    return gitFailure(context.logger, remotes.error);
  }
  const { source } = session;
  let pullRequestBase: GithubRemote | undefined;
  if (source.kind === 'github-pull-request') {
    pullRequestBase = { host: source.host, owner: source.owner, repo: source.repo };
  }
  return ok(choosePrimaryRemote(remotes.value, pullRequestBase));
}
