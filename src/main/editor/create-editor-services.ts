import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  EditorChoiceView,
  EditorFoundView,
  EditorOpenFailure,
  EditorOpenRequest,
  EditorOpenResponse,
  EditorSettingsView,
  IpcResult,
  OpenedConfigView,
  SetPreferredEditorRequest,
  SetReviewEditsPrefixRequest,
} from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import { resolveRevision } from '#internal/git/resolve-revision.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readPathStatus } from '#internal/git/read-path-status.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees, WorktreeLease } from '../worktrees/create-session-worktrees.ts';

import { chooseEditor } from './choose-editor.ts';
import type { ChosenEditor, DetectedEditor, EditorChoiceFailure } from './choose-editor.ts';
import { chooseEditorRoot } from './choose-editor-root.ts';
import type { WorkingFileState } from './choose-editor-root.ts';
import type { EditorSettings } from './create-editor-settings.ts';
import { editorDefinitions } from './editor-definitions.ts';
import type { EditorLocation } from './editor-location.ts';
import type { EditorPlatform } from './editor-platform.ts';
import { findEditor } from './find-editor.ts';
import type { FoundEditor } from './find-editor.ts';
import { isEditorId } from './is-editor-id.ts';
import { isEditorUrl } from './is-editor-url.ts';
import { planEditorLaunch } from './plan-editor-launch.ts';
import { resolveEditorDefinitions } from './resolve-editor-definitions.ts';

/** Opening files in the reviewer's editor, and which editor that is (ADR 0033, 0140). */
export interface EditorServices {
  readonly open: (request: EditorOpenRequest) => Promise<IpcResult<EditorOpenResponse>>;
  readonly getSettings: () => Promise<IpcResult<EditorSettingsView>>;
  readonly setPreferred: (
    request: SetPreferredEditorRequest,
  ) => Promise<IpcResult<EditorSettingsView>>;
  /** Sets the review-edits branch prefix (ADR 0088); a non-empty value without spaces or controls. */
  readonly setReviewEditsPrefix: (
    request: SetReviewEditsPrefixRequest,
  ) => Promise<IpcResult<EditorSettingsView>>;
  /**
   * Opens `settings.json` in the reviewer's own program for JSON files, so they can add editors
   * (ADR 0140). When there is no file yet, an empty object is created first; an existing file is
   * never rewritten for this.
   */
  readonly openSettingsFile: () => Promise<IpcResult<OpenedConfigView>>;
  /**
   * Opens an absolute path (a file or a directory) at a line in the chosen editor (ADR 0140): the
   * editor's name, or why it couldn't. For review edits (ADR 0088), whose caller has already
   * checked the path.
   */
  readonly launchFile: (location: EditorLocation) => Promise<Result<string, string>>;
}

export interface EditorServicesOptions {
  readonly context: SessionContext;
  readonly worktrees: SessionWorktrees;
  readonly settings: EditorSettings;
  readonly platform: EditorPlatform;
  /** Electron's `shell.openPath`: resolves to `''` on success, else a message. */
  readonly openPath?: (file: string) => Promise<string>;
}

const spaceOrControl = /[\s\p{Cc}]/u;

/** Every known editor as detected now, the stored choice, and the configuration's problems. */
interface EditorSnapshot {
  readonly preferred: string | undefined;
  readonly detected: readonly DetectedEditor[];
  readonly problems: readonly string[];
}

/** A session file to find on disk, as a path relative to the repository root. */
interface LocateRequest {
  readonly repository: GitRepository;
  readonly sessionId: string;
  readonly headSha: CommitSha;
  readonly relative: string;
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
 * chooses the editor ({@link chooseEditor}: the reviewer's, never a stand-in) and launches it
 * without a shell. The editors are the built-ins merged with `editors` in `settings.json`, read
 * afresh each time, so a hand edit takes effect on the next use.
 */
export function createEditorServices(options: EditorServicesOptions): EditorServices {
  const { context, worktrees, settings, platform } = options;
  let lastProblems = '';

  const snapshot = async (): Promise<EditorSnapshot> => {
    const { preferred, editors } = await settings.readEditorConfig();
    const { definitions, problems } = resolveEditorDefinitions({
      builtins: editorDefinitions,
      config: editors,
    });
    const problemsKey = JSON.stringify(problems);
    if (problemsKey !== lastProblems) {
      lastProblems = problemsKey;
      for (const problem of problems) {
        context.logger.warn('editor: left out an entry of settings.json', { problem });
      }
    }
    const detected = definitions.map((definition): DetectedEditor => {
      return { definition, found: findEditor(definition, platform) };
    });
    return { preferred, detected, problems };
  };

  const settingsView = async (): Promise<EditorSettingsView> => {
    const { preferred, detected, problems } = await snapshot();
    const editors = detected.map(({ definition, found }): EditorChoiceView => {
      return {
        id: definition.id,
        name: definition.name,
        installed: found !== undefined,
        origin: definition.origin,
        ...(found !== undefined && { found: foundViewFrom(found) }),
      };
    });
    const chosen = chooseEditor({ preferred, detected });
    return {
      ...(preferred !== undefined && { preferred }),
      ...(chosen.ok && { current: chosen.value.definition.id }),
      editors,
      problems,
      reviewEditsPrefix: await settings.readReviewEditsPrefix(),
    };
  };

  const choose = async (): Promise<Result<ChosenEditor, EditorChoiceFailure>> => {
    const { preferred, detected } = await snapshot();
    return chooseEditor({ preferred, detected });
  };

  const locate = async ({
    repository,
    sessionId,
    headSha,
    relative,
  }: LocateRequest): Promise<Located | EditorOpenFailure> => {
    const working = path.join(repository.root, relative);
    const workingHead = await resolveRevision(repository, 'HEAD');
    const workingFile = await readWorkingFileState(repository, relative);
    const root = chooseEditorRoot({
      workingTreeHead: valueOrUndefined(workingHead),
      sessionHead: headSha,
      workingFile,
    });
    if (root === 'working-tree') {
      if (await isInsideRoot({ root: repository.root, file: working })) {
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
    if (!(await isInsideRoot({ root: checkout.value.path, file }))) {
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
      const chosen = await choose();
      if (!chosen.ok) {
        return failedOpen(chosen.error.failure, chosen.error.message);
      }
      const located = await locate({
        repository,
        sessionId: session.id,
        headSha: session.headSha,
        relative: request.path,
      });
      if (typeof located === 'string') {
        return failedOpen(
          'file-unavailable',
          `${request.path} is not available at the session head.`,
        );
      }
      using _checkout = located.checkout;
      const { definition, found } = chosen.value;
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
        headSha: session.headSha,
      });
    },
    getSettings: async (): Promise<IpcResult<EditorSettingsView>> => {
      return ok(await settingsView());
    },
    setReviewEditsPrefix: async ({ prefix }): Promise<IpcResult<EditorSettingsView>> => {
      if (prefix === '' || prefix.length > 100 || spaceOrControl.test(prefix)) {
        return err({ code: 'invalid-request', message: 'a branch prefix without spaces' });
      }
      await settings.writeReviewEditsPrefix(prefix);
      return ok(await settingsView());
    },
    launchFile: async (location): Promise<Result<string, string>> => {
      const chosen = await choose();
      if (!chosen.ok) {
        return err(chosen.error.message);
      }
      const { definition, found } = chosen.value;
      const launched = await launch(platform, planEditorLaunch(definition, found, location));
      if (launched !== undefined) {
        context.logger.warn('editor launch failed', { editor: definition.id, reason: launched });
        return err(`Could not start ${definition.name}: ${launched}`);
      }
      return ok(definition.name);
    },
    setPreferred: async ({ editorId }): Promise<IpcResult<EditorSettingsView>> => {
      const { detected } = await snapshot();
      const known = detected.map(({ definition }) => definition.id);
      if (!isEditorId(editorId) || !known.includes(editorId)) {
        return err({
          code: 'invalid-request',
          message: `There is no editor “${editorId}”. Known editors: ${known.join(', ')}; add your own under "editors" in settings.json.`,
        });
      }
      await settings.write(editorId);
      return ok(await settingsView());
    },
    openSettingsFile: async (): Promise<IpcResult<OpenedConfigView>> => {
      const { filePath } = settings;
      if (filePath === undefined || options.openPath === undefined) {
        return err({ code: 'not-wired', message: 'there is no settings file to open' });
      }
      const created = await createIfMissing(filePath);
      if (!created.ok) {
        context.logger.warn('could not create settings.json', { file: filePath });
        return err({ code: 'internal', message: `Could not create ${filePath}: ${created.error}` });
      }
      const failure = await options.openPath(filePath);
      if (failure !== '') {
        context.logger.warn('could not open settings.json', { file: filePath, failure });
        return err({ code: 'internal', message: `Could not open ${filePath}: ${failure}` });
      }
      return ok({ path: filePath, created: created.value });
    },
  };
}

function foundViewFrom(found: FoundEditor): EditorFoundView {
  if (found.kind === 'cli') {
    return { kind: 'cli', path: found.command };
  }
  return { kind: 'url', path: found.bundle };
}

/**
 * Whether the file had to be created: `{}`, owner-only (ADR 0082), never replacing a file that
 * exists or appeared in the meantime.
 */
async function createIfMissing(file: string): Promise<Result<boolean, string>> {
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, '{}\n', { flag: 'wx', mode: 0o600 });
    return ok(true);
  } catch (error: unknown) {
    if (Error.isError(error) && 'code' in error && error.code === 'EEXIST') {
      return ok(false);
    }
    return err(errorFrom(error).message);
  }
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

function valueOrUndefined<T>(result: Result<T, unknown>): T | undefined {
  if (result.ok) {
    return result.value;
  }
  return undefined;
}

async function readWorkingFileState(
  repository: GitRepository,
  relative: string,
): Promise<WorkingFileState> {
  if (!(await isPresent(path.join(repository.root, relative)))) {
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

/** A file and the directory it must stay inside. */
interface RootedFile {
  readonly root: string;
  readonly file: string;
}

/** Whether `file` exists and, symlinks resolved, lies inside `root`. */
async function isInsideRoot({ root, file }: RootedFile): Promise<boolean> {
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
