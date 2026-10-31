import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  EditorChoiceView,
  EditorId,
  EditorOpenFailure,
  EditorOpenRequest,
  EditorOpenResponse,
  EditorSettingsView,
  IpcResult,
  SetPreferredEditorRequest,
} from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readPathStatus } from '#internal/git/read-path-status.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees, WorktreeLease } from '../worktrees/create-session-worktrees.ts';

import { chooseEditorRoot } from './choose-editor-root.ts';
import type { WorkingFileState } from './choose-editor-root.ts';
import type { EditorSettings } from './create-editor-settings.ts';
import { editorDefinitions } from './editor-definitions.ts';
import type { EditorDefinition } from './editor-definitions.ts';
import type { EditorPlatform } from './editor-platform.ts';
import { findEditor } from './find-editor.ts';
import type { FoundEditor } from './find-editor.ts';
import { isEditorUrl } from './is-editor-url.ts';
import { planEditorLaunch } from './plan-editor-launch.ts';

/** Opening files in the reviewer's editor, and which editor that is (ADR 0033). */
export interface EditorServices {
  readonly open: (request: EditorOpenRequest) => Promise<IpcResult<EditorOpenResponse>>;
  readonly getSettings: () => Promise<IpcResult<EditorSettingsView>>;
  readonly setPreferred: (
    request: SetPreferredEditorRequest,
  ) => Promise<IpcResult<EditorSettingsView>>;
}

export interface EditorServicesOptions {
  readonly context: SessionContext;
  readonly worktrees: SessionWorktrees;
  readonly settings: EditorSettings;
  readonly platform: EditorPlatform;
}

interface Located {
  readonly file: string;
  readonly location: 'working-tree' | 'beuve-checkout';
  /** Keeps beuve's checkout on disk until the editor has started. */
  readonly checkout?: WorktreeLease;
}

/**
 * `editor:open` refreshes the session, picks the working tree or beuve's head checkout
 * ({@link chooseEditorRoot}), checks the file stays inside that root once symlinks are resolved,
 * finds the preferred (else first installed) editor and launches it without a shell.
 */
export function createEditorServices(options: EditorServicesOptions): EditorServices {
  const { context, worktrees, settings, platform } = options;

  const detectAll = (): readonly {
    definition: EditorDefinition;
    found: FoundEditor | undefined;
  }[] => {
    return editorDefinitions.map((definition) => {
      return {
        definition,
        found: findEditor(definition, platform),
      };
    });
  };

  const settingsView = async (): Promise<EditorSettingsView> => {
    const preferred = await settings.read();
    const detected = detectAll();
    const editors: EditorChoiceView[] = detected.map(({ definition, found }) => {
      return {
        id: definition.id,
        name: definition.name,
        installed: found !== undefined,
      };
    });
    return { ...(preferred !== undefined && { preferred }), editors };
  };

  const locate = async (
    repository: GitRepository,
    sessionId: string,
    headSha: CommitSha,
    relative: string,
  ): Promise<Located | EditorOpenFailure> => {
    const working = path.join(repository.root, relative);
    const workingHead = await resolveRevision(repository, 'HEAD');
    const workingFile = await readWorkingFileState(repository, working, relative);
    const root = chooseEditorRoot({
      workingTreeHead: workingHead.ok ? workingHead.value : undefined,
      sessionHead: headSha,
      workingFile,
    });
    if (root === 'working-tree') {
      if (await isInsideRoot(repository.root, working)) {
        return { file: working, location: root };
      }
      return 'file-unavailable';
    }
    const checkout = await worktrees.acquire(repository, {
      kind: 'session-head',
      sessionId,
      headSha,
    });
    if (!checkout.ok) {
      context.logger.warn('editor: could not check out the head', { error: checkout.error });
      return 'file-unavailable';
    }
    const file = path.join(checkout.value.path, relative);
    if (!(await isInsideRoot(checkout.value.path, file))) {
      checkout.value[Symbol.dispose]();
      return 'file-unavailable';
    }
    return { file, location: root, checkout: checkout.value };
  };

  return {
    open: async (request): Promise<IpcResult<EditorOpenResponse>> => {
      const loaded = loadSession(context, request.sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const refreshed = await refreshSession(context, loaded.value);
      if (!refreshed.ok) {
        return refreshed;
      }
      const { repository, session } = refreshed.value;
      const preferred = await settings.read();
      const detected = detectAll();
      const candidates = [
        ...detected.filter(({ definition }) => definition.id === preferred),
        ...detected.filter(({ definition }) => definition.id !== preferred),
      ];
      const chosen = candidates.find(({ found: candidate }) => candidate !== undefined);
      const found = chosen?.found;
      if (chosen === undefined || found === undefined) {
        return failedOpen(
          'no-editor-found',
          'No editor found: install Zed, VS Code or Cursor, or choose one with /editor.',
        );
      }
      const located = await locate(repository, session.id, session.headSha, request.path);
      if (typeof located === 'string') {
        return failedOpen(
          'file-unavailable',
          `${request.path} is not available at the session head.`,
        );
      }
      using _checkout = located.checkout;
      const { definition } = chosen;
      const plan = planEditorLaunch(definition, found, {
        file: located.file,
        line: request.line,
        column: request.column ?? 1,
      });
      const launched = await launch(platform, plan);
      if (launched !== undefined) {
        context.logger.warn('editor launch failed', { editor: definition.id, reason: launched });
        return failedOpen('launch-failed', `Could not start ${definition.name}: ${launched}`);
      }
      return ok({
        kind: 'opened',
        editorId: definition.id,
        editorName: definition.name,
        location: located.location,
        path: request.path,
        line: request.line,
      });
    },
    getSettings: async (): Promise<IpcResult<EditorSettingsView>> => {
      return ok(await settingsView());
    },
    setPreferred: async ({ editorId }): Promise<IpcResult<EditorSettingsView>> => {
      if (!isEditorId(editorId)) {
        return err({ code: 'invalid-request', message: 'unknown editor' });
      }
      await settings.write(editorId);
      return ok(await settingsView());
    },
  };
}

function isEditorId(value: string): value is EditorId {
  return editorDefinitions.some((definition) => definition.id === value);
}

/** The failure reason, or `undefined` when the editor started. */
async function launch(
  platform: EditorPlatform,
  plan: ReturnType<typeof planEditorLaunch>,
): Promise<string | undefined> {
  if (plan.kind === 'spawn') {
    const started = await platform.spawn(plan.command, plan.args);
    if (started.ok) {
      return undefined;
    }
    return started.error;
  }
  if (!isEditorUrl(plan.url) || platform.openExternal === undefined) {
    return 'cannot open the editor URL here';
  }
  try {
    await platform.openExternal(plan.url);
    return undefined;
  } catch (error: unknown) {
    return errorFrom(error).message;
  }
}

async function readWorkingFileState(
  repository: GitRepository,
  file: string,
  relative: string,
): Promise<WorkingFileState> {
  if (!(await isPresent(file))) {
    return 'missing';
  }
  const status = await readPathStatus(repository, relative);
  if (status.ok) {
    return status.value;
  }
  return 'modified';
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await realpath(file);
    return true;
  } catch {
    return false;
  }
}

/** Whether `file` exists and, symlinks resolved, lies inside `root`. */
async function isInsideRoot(root: string, file: string): Promise<boolean> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)]);
    const relative = path.relative(realRoot, realFile);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function failedOpen(failure: EditorOpenFailure, message: string): IpcResult<EditorOpenResponse> {
  return ok({ kind: 'failed', failure, message });
}
