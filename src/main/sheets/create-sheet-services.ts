import type {
  IpcResult,
  OpenedView,
  OpenSheetRequest,
  SheetFileRequest,
  SheetFileView,
  SheetHeadRequest,
  SheetHeadView,
  SheetNoteView,
  UraItemView,
} from '#contract/ipc-contract.ts';
import { diffObjects } from '#internal/git/diff-objects.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { findSessionForkPoint } from '../sessions/find-session-fork-point.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import { readSheetSource } from './read-sheet-source.ts';
import { resolveSheetCommit } from './resolve-sheet-commit.ts';
import { sheetMarksFrom } from './sheet-marks-from.ts';

/** What sheets (ADR 0067) read: a file at one commit, and where the session head is now. */
export interface SheetServices {
  readonly getFile: (
    request: SheetFileRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<SheetFileView>>;
  readonly getHead: (
    request: SheetHeadRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<SheetHeadView>>;
  /** Checks that the sheet's commit and file exist before main opens a window for it. */
  readonly checkOpen: (request: OpenSheetRequest) => Promise<IpcResult<OpenedView>>;
}

export interface SheetServicesOptions {
  readonly context: SessionContext;
  readonly ura: Pick<UraServices, 'list'>;
}

/**
 * `sheet:get-file` reads `path` at the sheet's pinned commit (never "the head now"), with gutter
 * marks against where the change starts (the session base's fork point for that commit), and the
 * session's staged notes when the commit is the session head, where their lines are placed.
 */
export function createSheetServices(options: SheetServicesOptions): SheetServices {
  const { context, ura } = options;
  return {
    getFile: async ({ sessionId, sha, path }, call = {}): Promise<IpcResult<SheetFileView>> => {
      const commit = await resolveSheetCommit(context, { sessionId, sha }, call);
      if (!commit.ok) {
        return commit;
      }
      const contents = await readSheetSource(context, commit.value, path);
      if (!contents.ok) {
        return contents;
      }
      const { repository, baseTip, session } = commit.value.refreshed;
      const fork = await findSessionForkPoint(
        context,
        { repository, range: { base: baseTip, head: commit.value.sha } },
        { signal: call.signal },
      );
      if (!fork.ok) {
        return gitFailure(context.logger, fork.error);
      }
      const files = await diffObjects(
        repository,
        { from: fork.value.forkPoint, to: commit.value.sha },
        {
          paths: [path],
          contextLines: 0,
        },
      );
      if (!files.ok) {
        return gitFailure(context.logger, files.error);
      }
      const lineCount = contents.value.split('\n').length;
      const isHead = commit.value.sha === session.headSha;
      let notes: SheetFileView['notes'] = [];
      if (isHead) {
        const listed = await ura.list({ sessionId: session.id });
        if (listed.ok) {
          notes = notesOn(path, listed.value.items);
        }
      }
      return ok({
        sessionId: session.id,
        sha: commit.value.sha,
        headSha: session.headSha,
        baseSha: fork.value.forkPoint,
        path,
        contents: contents.value,
        marks: sheetMarksFrom(files.value[0]?.hunks ?? [], lineCount),
        notes,
      });
    },
    getHead: async ({ sessionId }, call = {}): Promise<IpcResult<SheetHeadView>> => {
      const loaded = loadSession(context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const refreshed = await refreshSession(context, loaded.value, { signal: call.signal });
      if (refreshed.ok) {
        return ok({
          sessionId: refreshed.value.session.id,
          headSha: refreshed.value.session.headSha,
        });
      }
      return refreshed;
    },
    checkOpen: async ({ sessionId, sha, path }): Promise<IpcResult<OpenedView>> => {
      const commit = await resolveSheetCommit(context, { sessionId, sha });
      if (!commit.ok) {
        return commit;
      }
      const contents = await readSheetSource(context, commit.value, path);
      if (contents.ok) {
        return ok({ opened: true });
      }
      return contents;
    },
  };
}

function notesOn(path: string, items: readonly UraItemView[]): SheetNoteView[] {
  return items.flatMap((item): SheetNoteView[] => {
    const { placement } = item;
    if (
      item.status.kind !== 'staged' ||
      placement.kind !== 'current' ||
      placement.anchor.kind !== 'lines' ||
      placement.anchor.path !== path
    ) {
      return [];
    }
    return [
      {
        startLine: placement.anchor.startLine,
        endLine: placement.anchor.endLine,
        severity: item.severity,
        title: item.title,
      },
    ];
  });
}
