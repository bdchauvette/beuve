import type { CommitInfoView, GetCommitRequest, IpcResult } from '#contract/ipc-contract.ts';
import { readCommitInfo } from '#internal/git/read-commit-info.ts';
import type { CommitSignature } from '#internal/git/read-commit-info.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { resolveSheetCommit } from '../sheets/resolve-sheet-commit.ts';

/** `session:get-commit`: one commit of a session's repository, for a commit hash's card (ADR 0116). */
export interface CommitServices {
  readonly getCommit: (
    request: GetCommitRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<CommitInfoView>>;
}

export interface CommitServicesOptions {
  readonly context: SessionContext;
}

/**
 * Reads commit `sha` of the session's repository: its parents, author, committer and message.
 * `sha` must name a commit by its full object name (as `remote:open-commit` requires); a commit
 * the clone does not have answers `not-found`.
 */
export function createCommitServices(options: CommitServicesOptions): CommitServices {
  const { context } = options;
  return {
    getCommit: async (request, call = {}): Promise<IpcResult<CommitInfoView>> => {
      const commit = await resolveSheetCommit(context, request, call);
      if (!commit.ok) {
        return commit;
      }
      const read = await readCommitInfo(commit.value.refreshed.repository, commit.value.sha, {
        signal: call.signal,
      });
      if (!read.ok) {
        return gitFailure(context.logger, read.error);
      }
      if (read.value === undefined) {
        return err({ code: 'not-found', message: 'that commit could not be read' });
      }
      const { sha, parents, author, committer, subject, body } = read.value;
      return ok({
        sha,
        parents,
        author: signatureViewFrom(author),
        committer: signatureViewFrom(committer),
        subject,
        body,
      });
    },
  };
}

function signatureViewFrom({ name, email, at }: CommitSignature): CommitInfoView['author'] {
  return { name, email, at: at.toString() };
}
