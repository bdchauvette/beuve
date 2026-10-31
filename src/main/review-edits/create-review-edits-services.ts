import { createHash } from 'node:crypto';
import { mkdtempDisposable, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  IpcError,
  IpcResult,
  OpenReviewEditsRequest,
  ReviewEditPreviewView,
  ReviewEditsDiscardedView,
  ReviewEditsDiscardView,
  ReviewEditsOpenedView,
  ReviewEditsPlanView,
  ReviewEditsRequest,
  ReviewEditsStagedView,
  ReviewEditsView,
  StageReviewEditsRequest,
  DiscardReviewEditsRequest,
  UpdateUraItemRequest,
} from '#contract/ipc-contract.ts';
import { checkBranchName } from '#internal/git/check-branch-name.ts';
import { countCommits } from '#internal/git/count-commits.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { diffObjects } from '#internal/git/diff-objects.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { CommitSha, TreeSha } from '#internal/git/object-id.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import { snapshotWorktree } from '#internal/git/snapshot-worktree.ts';
import { deleteReviewEditBranch } from '#internal/review-edits/delete-review-edit-branch.ts';
import { findReviewEditBranch } from '#internal/review-edits/find-review-edit-branch.ts';
import { insertReviewEditBranch } from '#internal/review-edits/insert-review-edit-branch.ts';
import { listEditSuggestions } from '#internal/review-edits/list-edit-suggestions.ts';
import { recordEditSuggestion } from '#internal/review-edits/record-edit-suggestion.ts';
import type { ReviewEditBranch } from '#internal/review-edits/review-edit-branch.ts';
import type { Session } from '#internal/session/session.ts';
import { listUraItems } from '#internal/ura/list-ura-items.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { EditorServices } from '../editor/create-editor-services.ts';
import type { EditorSettings } from '../editor/create-editor-settings.ts';
import { findSessionForkPoint } from '../sessions/find-session-fork-point.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { headPathOf } from '../sessions/head-path-of.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { UraServices } from '../ura/create-ura-services.ts';
import type { SessionWorktrees, WorktreeLease } from '../worktrees/create-session-worktrees.ts';
import { worktreeFailure } from '../worktrees/worktree-failure.ts';

import { planEditSuggestions } from './plan-edit-suggestions.ts';
import type { EditPlan, NoteAtHead } from './plan-edit-suggestions.ts';

/** Review edits (ADR 0088): a writable branch per session whose edits become review suggestions. */
export interface ReviewEditsServices {
  readonly get: (request: ReviewEditsRequest) => Promise<IpcResult<ReviewEditsView>>;
  readonly open: (request: OpenReviewEditsRequest) => Promise<IpcResult<ReviewEditsOpenedView>>;
  readonly previewSuggestions: (
    request: ReviewEditsRequest,
  ) => Promise<IpcResult<ReviewEditsPlanView>>;
  readonly stageSuggestions: (
    request: StageReviewEditsRequest,
  ) => Promise<IpcResult<ReviewEditsStagedView>>;
  readonly previewDiscard: (
    request: ReviewEditsRequest,
  ) => Promise<IpcResult<ReviewEditsDiscardView>>;
  readonly discard: (
    request: DiscardReviewEditsRequest,
  ) => Promise<IpcResult<ReviewEditsDiscardedView>>;
}

export interface ReviewEditsServicesOptions {
  readonly context: SessionContext;
  readonly worktrees: SessionWorktrees;
  readonly ura: UraServices;
  readonly editor: EditorServices;
  readonly settings: EditorSettings;
}

/** A session with its repository, and its review-edits branch if beuve made one. */
interface Owned {
  readonly session: Session;
  readonly repository: GitRepository;
  readonly record: ReviewEditBranch | undefined;
}

/** What the edits hold now: the branch tip, the working tree as a tree, and the changed files. */
interface EditsState {
  readonly tip: CommitSha;
  readonly tree: TreeSha | CommitSha;
  readonly files: readonly DiffFile[];
  readonly commits: number;
}

/** A session's branch record and the repository it is in. */
interface OwnedBranch {
  readonly repository: GitRepository;
  readonly record: ReviewEditBranch;
}

/**
 * Composes the git domain's branch worktrees, the worktree manager's `review-edits` lease, the
 * review-edits ownership records and the URA (ADR 0088). beuve writes only into the edits
 * worktree's branch through `git worktree add`, never commits to it, never touches the reviewer's
 * own checkout or index, and never pushes. Edits flow back as URA items.
 */
export function createReviewEditsServices(
  options: ReviewEditsServicesOptions,
): ReviewEditsServices {
  const { context, worktrees, ura, editor, settings } = options;
  const { db, logger } = context;

  const ownedBy = async (sessionId: string): Promise<Result<Owned, IpcError>> => {
    const loaded = loadSession(context, sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const refreshed = await refreshSession(context, loaded.value);
    if (!refreshed.ok) {
      return refreshed;
    }
    const found = findReviewEditBranch(db, { sessionId: refreshed.value.session.id });
    if (!found.ok) {
      return err({ code: 'internal', message: 'the review-edits record is unreadable' });
    }
    return ok({ ...refreshed.value, record: found.value });
  };

  const plannedBranch = async (session: Session): Promise<string> => {
    const prefix = await settings.readReviewEditsPrefix();
    if (session.source.kind === 'github-pull-request') {
      return `${prefix}pr-${String(session.source.number)}`;
    }
    return `${prefix}session-${session.id.slice(0, 8)}`;
  };

  /** The session's branch, recorded now if it has none; refuses a name that isn't beuve's. */
  const claimBranch = async ({
    session,
    repository,
    record,
  }: Owned): Promise<Result<ReviewEditBranch, IpcError>> => {
    if (record !== undefined) {
      return ok(record);
    }
    const checked = await checkBranchName(repository, await plannedBranch(session));
    if (!checked.ok) {
      return err({
        code: 'refused',
        message: `The review-edits branch name is invalid (${describeGitRefusal(checked.error)}): change the review-edits prefix in Settings.`,
      });
    }
    const branch = checked.value;
    const existing = await resolveRevision(repository, `refs/heads/${branch}`);
    if (existing.ok) {
      return err({
        code: 'refused',
        message: `A branch named ${branch} already exists and isn't beuve's review edits for this session. Rename it, or change the review-edits prefix in Settings.`,
      });
    }
    const claimed: ReviewEditBranch = {
      sessionId: session.id,
      repoPath: repository.root,
      branch,
      baseSha: session.headSha,
      createdAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
    };
    const inserted = insertReviewEditBranch(db, claimed);
    if (inserted.ok) {
      return ok(claimed);
    }
    if (inserted.error.kind === 'session-taken') {
      const again = findReviewEditBranch(db, { sessionId: session.id });
      if (again.ok && again.value !== undefined) {
        return ok(again.value);
      }
    }
    return err({
      code: 'refused',
      message: `${branch} is another session's review edits. Change the review-edits prefix in Settings.`,
    });
  };

  const lease = async ({
    repository,
    record,
  }: OwnedBranch): Promise<Result<WorktreeLease, IpcError>> => {
    const leased = await worktrees.acquire(repository, {
      kind: 'review-edits',
      sessionId: record.sessionId,
      branch: record.branch,
      base: record.baseSha,
    });
    if (leased.ok) {
      return leased;
    }
    if (leased.error.kind === 'worktree-conflict') {
      return err({ code: 'refused', message: `Review edits: ${leased.error.reason}.` });
    }
    return worktreeFailure(logger, leased.error);
  };

  /** What the edits hold: from the worktree when it is on disk, else from the branch alone. */
  const inspect = async ({
    repository,
    record,
  }: OwnedBranch): Promise<Result<EditsState, IpcError>> => {
    const base = record.baseSha;
    const tip = await resolveRevision(repository, `refs/heads/${record.branch}`);
    if (!tip.ok) {
      return gitFailure(logger, tip.error);
    }
    const commits = await countCommits(repository, { from: base, to: tip.value });
    if (!commits.ok) {
      return gitFailure(logger, commits.error);
    }
    const where = await worktrees.editsPath(repository, record.branch);
    let tree: TreeSha | CommitSha = tip.value;
    if (where.ok && (await isWorktreeAt(where.value))) {
      const snapshot = await snapshotOf(where.value);
      if (!snapshot.ok) {
        return gitFailure(logger, snapshot.error);
      }
      tree = snapshot.value;
    }
    const files = await diffObjects(repository, { from: base, to: tree }, { contextLines: 0 });
    if (!files.ok) {
      return gitFailure(logger, files.error);
    }
    return ok({ tip: tip.value, tree, files: files.value, commits: commits.value });
  };

  const snapshotOf = async (worktree: string): Promise<Result<TreeSha, GitError>> => {
    const opened = await openRepository(worktree, context.git);
    if (!opened.ok) {
      return opened;
    }
    const temporary = await realpath(os.tmpdir());
    await using scratch = await mkdtempDisposable(path.join(temporary, 'beuve-edits-'));
    return await snapshotWorktree(opened.value, scratch.path);
  };

  /** The harvest's plan for the edits as they stand. */
  const plan = async (
    owned: OwnedBranch,
    state: EditsState,
  ): Promise<Result<EditPlan, IpcError>> => {
    const { repository, record } = owned;
    const base = record.baseSha;
    const changedLines = await prChangedLines(owned);
    if (!changedLines.ok) {
      return changedLines;
    }
    const modified = state.files.filter((file) => file.status === 'modified' && !file.binary);
    const blobs = await readBlobs(
      repository,
      modified
        .flatMap((file) => {
          return file.oldObject ?? [];
        })
        .map((objectId) => {
          return { objectId };
        }),
    );
    if (!blobs.ok) {
      return gitFailure(logger, blobs.error);
    }
    const headTexts = new Map<string, string>();
    for (const file of modified) {
      const blob = blobs.value.get(file.oldObject ?? '');
      if (blob?.kind === 'text') {
        headTexts.set(headPathOf(file), blob.text);
      }
    }
    const items = listUraItems(db, record.sessionId);
    if (!items.ok) {
      return err({ code: 'internal', message: 'the review items are unreadable' });
    }
    const notes: NoteAtHead[] = [];
    for (const item of items.value) {
      if (item.status.kind === 'staged' && item.headSha === base && item.anchor.kind === 'lines') {
        notes.push({
          itemId: item.id,
          path: item.anchor.path,
          startLine: item.anchor.startLine,
          endLine: item.anchor.endLine,
          suggestion: item.suggestion?.text,
        });
      }
    }
    return ok(
      planEditSuggestions({
        edits: state.files,
        headTexts,
        changedLines: changedLines.value,
        notes,
        harvested: listEditSuggestions(db, { sessionId: record.sessionId, headSha: base }),
        branch: record.branch,
      }),
    );
  };

  /** The head lines the pull request added at the edits' base, by path. */
  const prChangedLines = async ({
    repository,
    record,
  }: OwnedBranch): Promise<Result<ReadonlyMap<string, ReadonlySet<number>>, IpcError>> => {
    const loaded = loadSession(context, record.sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const base = record.baseSha;
    const refreshed = await refreshSession(context, loaded.value, { headSha: base });
    if (!refreshed.ok) {
      return refreshed;
    }
    const fork = await findSessionForkPoint(context, {
      repository,
      range: { base: refreshed.value.baseTip, head: base },
    });
    if (!fork.ok) {
      return gitFailure(logger, fork.error);
    }
    const diff = await diffObjects(
      repository,
      { from: fork.value.forkPoint, to: base },
      { contextLines: 0 },
    );
    if (!diff.ok) {
      return gitFailure(logger, diff.error);
    }
    const changed = new Map<string, Set<number>>();
    for (const file of diff.value) {
      const lines = changed.getOrInsertComputed(headPathOf(file), () => new Set<number>());
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind === 'added') {
            lines.add(line.newLine);
          }
        }
      }
    }
    return ok(changed);
  };

  /** The session's recorded branch, or a refusal saying there are no review edits yet. */
  const recorded = async (sessionId: string): Promise<Result<OwnedBranch, IpcError>> => {
    const owned = await ownedBy(sessionId);
    if (!owned.ok) {
      return owned;
    }
    const { repository, record } = owned.value;
    if (record === undefined) {
      return err({ code: 'refused', message: 'No review edits yet: use Open Review Edits first.' });
    }
    return ok({ repository, record });
  };

  return {
    get: async ({ sessionId }): Promise<IpcResult<ReviewEditsView>> => {
      const owned = await ownedBy(sessionId);
      if (!owned.ok) {
        return owned;
      }
      const { session, repository, record } = owned.value;
      if (record === undefined) {
        return ok({
          sessionId: session.id,
          branch: await plannedBranch(session),
          exists: false,
          isOnSessionHead: true,
          files: 0,
          commits: 0,
        });
      }
      const state = await inspect({ repository, record });
      if (!state.ok) {
        return state;
      }
      const where = await worktrees.editsPath(repository, record.branch);
      let present: string | undefined;
      if (where.ok && (await isWorktreeAt(where.value))) {
        present = where.value;
      }
      return ok({
        sessionId: session.id,
        branch: record.branch,
        exists: true,
        ...(present !== undefined && { path: present }),
        baseSha: record.baseSha,
        isOnSessionHead: record.baseSha === session.headSha,
        files: state.value.files.length,
        commits: state.value.commits,
      });
    },

    open: async (request): Promise<IpcResult<ReviewEditsOpenedView>> => {
      const owned = await ownedBy(request.sessionId);
      if (!owned.ok) {
        return owned;
      }
      const isNew = owned.value.record === undefined;
      const record = await claimBranch(owned.value);
      if (!record.ok) {
        return record;
      }
      const leased = await lease({ repository: owned.value.repository, record: record.value });
      if (!leased.ok) {
        return leased;
      }
      using checkout = leased.value;
      let file = checkout.path;
      if (request.path !== undefined) {
        file = path.join(checkout.path, request.path);
        if (!isInside({ root: checkout.path, candidate: file })) {
          return err({ code: 'invalid-request', message: 'path leaves the review edits' });
        }
      }
      const launched = await editor.launchFile({ file, line: request.line ?? 1, column: 1 });
      if (!launched.ok) {
        return err({ code: 'refused', message: launched.error });
      }
      return ok({
        editorName: launched.value,
        branch: record.value.branch,
        path: checkout.path,
        created: isNew,
      });
    },

    previewSuggestions: async ({ sessionId }): Promise<IpcResult<ReviewEditsPlanView>> => {
      const owned = await recorded(sessionId);
      if (!owned.ok) {
        return owned;
      }
      const leased = await lease(owned.value);
      if (!leased.ok) {
        return leased;
      }
      using _checkout = leased.value;
      const state = await inspect(owned.value);
      if (!state.ok) {
        return state;
      }
      const planned = await plan(owned.value, state.value);
      if (!planned.ok) {
        return planned;
      }
      return ok({
        sessionId: owned.value.record.sessionId,
        branch: owned.value.record.branch,
        headSha: owned.value.record.baseSha,
        digest: planned.value.digest,
        edits: planned.value.edits.map((edit): ReviewEditPreviewView => {
          return {
            action: edit.action,
            kind: edit.kind,
            anchor: edit.anchor,
            title: edit.title,
            diff: edit.diff,
          };
        }),
      });
    },

    stageSuggestions: async ({ sessionId, digest }): Promise<IpcResult<ReviewEditsStagedView>> => {
      const owned = await recorded(sessionId);
      if (!owned.ok) {
        return owned;
      }
      const leased = await lease(owned.value);
      if (!leased.ok) {
        return leased;
      }
      using _checkout = leased.value;
      const state = await inspect(owned.value);
      if (!state.ok) {
        return state;
      }
      const planned = await plan(owned.value, state.value);
      if (!planned.ok) {
        return planned;
      }
      if (planned.value.digest !== digest) {
        return err({
          code: 'refused',
          message: 'The review edits changed since the preview: preview them again.',
        });
      }
      const { record } = owned.value;
      const counts = { created: 0, attached: 0, updated: 0, unchanged: 0 };
      for (const edit of planned.value.edits) {
        if (edit.action === 'unchanged') {
          counts.unchanged += 1;
          continue;
        }
        let itemId = edit.itemId;
        if (edit.action === 'create') {
          const created = await ura.create({
            sessionId: record.sessionId,
            headSha: record.baseSha,
            anchor: edit.anchor,
            severity: 'issue',
            title: edit.title,
            body: edit.body,
            ...(edit.patch !== undefined && { suggestedPatch: edit.patch }),
          });
          if (!created.ok) {
            return created;
          }
          itemId = created.value.id;
          counts.created += 1;
        } else {
          const updated = await ura.update(updateOf(edit, itemId ?? ''));
          if (!updated.ok) {
            return updated;
          }
          if (edit.action === 'attach') {
            counts.attached += 1;
          } else {
            counts.updated += 1;
          }
        }
        recordEditSuggestion(db, {
          sessionId: record.sessionId,
          headSha: record.baseSha,
          target: edit.target,
          itemId: itemId ?? '',
          fingerprint: edit.fingerprint,
        });
      }
      return ok(counts);
    },

    previewDiscard: async ({ sessionId }): Promise<IpcResult<ReviewEditsDiscardView>> => {
      const owned = await recorded(sessionId);
      if (!owned.ok) {
        return owned;
      }
      const state = await inspect(owned.value);
      if (!state.ok) {
        return state;
      }
      return ok({
        sessionId: owned.value.record.sessionId,
        branch: owned.value.record.branch,
        digest: discardDigest(state.value),
        commits: state.value.commits,
        files: state.value.files.map((file) => headPathOf(file)),
      });
    },

    discard: async ({ sessionId, digest }): Promise<IpcResult<ReviewEditsDiscardedView>> => {
      const owned = await recorded(sessionId);
      if (!owned.ok) {
        return owned;
      }
      const state = await inspect(owned.value);
      if (!state.ok) {
        return state;
      }
      if (discardDigest(state.value) !== digest) {
        return err({
          code: 'refused',
          message:
            'The review edits changed since you looked: check what Discard would lose again.',
        });
      }
      const { repository, record } = owned.value;
      const discarded = await worktrees.discardEdits(repository, {
        sessionId: record.sessionId,
        branch: record.branch,
        expectedTip: state.value.tip,
      });
      if (!discarded.ok) {
        if (discarded.error.kind === 'in-use' || discarded.error.kind === 'branch-moved') {
          return err({
            code: 'refused',
            message: 'The review edits are in use or moved; try again.',
          });
        }
        return gitFailure(logger, discarded.error);
      }
      deleteReviewEditBranch(db, record.sessionId);
      return ok({ branch: record.branch });
    },
  };
}

/** What `ura:update` gets for an attach or an update: the patch, or a note's new body. */
function updateOf(edit: EditPlan['edits'][number], itemId: string): UpdateUraItemRequest {
  if (edit.kind === 'suggestion') {
    return { itemId, suggestedPatch: edit.patch ?? '' };
  }
  return { itemId, body: edit.body, suggestedPatch: '' };
}

function describeGitRefusal(error: GitError): string {
  if (error.kind === 'invalid-argument') {
    return error.reason;
  }
  return error.kind;
}

function discardDigest(state: EditsState): string {
  return createHash('sha256')
    .update(JSON.stringify([state.tip, state.tree, state.commits]))
    .digest('hex');
}

/** Whether a linked worktree is checked out at `directory` (its `.git` file is there). */
async function isWorktreeAt(directory: string): Promise<boolean> {
  try {
    const stats = await stat(path.join(directory, '.git'));
    return stats.isFile();
  } catch {
    return false;
  }
}

/** A path, and the directory it must lie inside (or be). */
interface Containment {
  readonly root: string;
  readonly candidate: string;
}

function isInside({ root, candidate }: Containment): boolean {
  const relative = path.relative(root, candidate);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
