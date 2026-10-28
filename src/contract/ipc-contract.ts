import type { Result } from '#pkg/result/result.ts';

/**
 * The typed IPC contract between main, preload and ui (ADR 0011). Plain serializable data
 * only: everything here crosses a structured-clone boundary and must stay DOM- and Node-free.
 */

/** Static facts about the running app, for the status bar and diagnostics. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
}

/** What a session reviews: a local branch or a GitHub pull request. */
export type SessionSourceView =
  | {
      readonly kind: 'local';
      readonly repoPath: string;
      readonly baseRef: string;
      readonly headRef: string;
    }
  | {
      readonly kind: 'github-pull-request';
      readonly repoPath: string;
      readonly baseRef: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    };

/**
 * A review session as the UI sees it: the session domain's model flattened to plain strings.
 * `lastReviewedSha` (the last checkpoint's head) is absent until the first checkpoint.
 * Timestamps are ISO-8601 UTC.
 */
export interface SessionSummary {
  readonly id: string;
  readonly source: SessionSourceView;
  readonly headSha: string;
  readonly lastReviewedSha?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OpenSessionRequest {
  readonly sessionId: string;
}

/** Start (or resume) reviewing `headRef` against `baseRef` in the repository containing `repoPath`. */
export interface CreateLocalSessionRequest {
  /** Absolute path inside a git worktree; the session records the repository's top level. */
  readonly repoPath: string;
  readonly baseRef: string;
  readonly headRef: string;
}

export interface GetReviewRequest {
  readonly sessionId: string;
}

/**
 * Sign off on the session's current head. `expectedHeadSha`, when given, must equal the head the
 * reviewer was shown; if the head moved since, nothing is recorded and the call fails with
 * `stale-review`.
 */
export interface MarkReviewedRequest {
  readonly sessionId: string;
  readonly expectedHeadSha?: string;
}

/** Why an interdiff could not be trusted, so the full change is shown instead. */
export type InterdiffFallbackView =
  | { readonly kind: 'conflicts'; readonly paths: readonly string[] }
  | { readonly kind: 'git-too-old'; readonly version: string; readonly required: string }
  /** The previously reviewed commits are no longer in the repository (e.g. garbage-collected). */
  | { readonly kind: 'reviewed-commits-missing' };

/**
 * What the diff in a {@link ReviewView} covers.
 *
 * - `full`: never reviewed; the whole change since it forked from the base branch.
 * - `up-to-date`: the last checkpoint is the head; no files.
 * - `interdiff`: only what changed since the last checkpoint. `exact` when the fork point didn't
 *   move, `rebased` when the branch was rebased (upstream changes cancel out), `fallback` when no
 *   trustworthy interdiff exists and the full change is shown, with the reason.
 */
export type ReviewScope =
  | { readonly kind: 'full' }
  | { readonly kind: 'up-to-date' }
  | {
      readonly kind: 'interdiff';
      readonly fromBaseSha: string;
      readonly fromHeadSha: string;
      readonly outcome:
        | { readonly kind: 'exact' }
        | { readonly kind: 'rebased' }
        | { readonly kind: 'fallback'; readonly reason: InterdiffFallbackView };
    };

/** A hunk's position; its lines are in the file's `patch`. */
export interface DiffHunkView {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  /** The full `@@ -a,b +c,d @@ …` line. */
  readonly header: string;
}

/** One file of a review diff. `oldPath` is set for renames and copies. */
export interface DiffFileView {
  readonly status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
  readonly path: string;
  readonly oldPath?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunkView[];
  /** The file's unified diff text, from `diff --git` on, newline-terminated. */
  readonly patch: string;
}

/**
 * What the reviewer should look at now. `baseSha` is where `headSha` forked from the base
 * branch; marking the session reviewed records that pair.
 */
export interface ReviewView {
  readonly session: SessionSummary;
  readonly scope: ReviewScope;
  readonly baseSha: string;
  readonly headSha: string;
  readonly files: readonly DiffFileView[];
}

/**
 * Expected failures of an invoke channel. `not-wired` means the backing service isn't composed
 * yet; `stale-review` that the head moved after the reviewer last saw it.
 */
export type IpcErrorCode =
  | 'invalid-request'
  | 'not-wired'
  | 'not-found'
  | 'not-a-repository'
  | 'unknown-revision'
  | 'git-unavailable'
  | 'git-failed'
  | 'stale-review'
  | 'internal';

export interface IpcError {
  readonly code: IpcErrorCode;
  readonly message: string;
}

/** Every invoke response is a `Result`, so expected failures never surface as rejected promises. */
export type IpcResult<T> = Result<T, IpcError>;

/** Request/response pairs for `ipcRenderer.invoke` channels. */
export interface InvokeChannelMap {
  'app:get-info': { readonly request: undefined; readonly response: IpcResult<AppInfo> };
  'session:list': {
    readonly request: undefined;
    readonly response: IpcResult<readonly SessionSummary[]>;
  };
  'session:open': {
    readonly request: OpenSessionRequest;
    readonly response: IpcResult<SessionSummary>;
  };
  'session:create-local': {
    readonly request: CreateLocalSessionRequest;
    readonly response: IpcResult<SessionSummary>;
  };
  'session:get-review': {
    readonly request: GetReviewRequest;
    readonly response: IpcResult<ReviewView>;
  };
  'session:mark-reviewed': {
    readonly request: MarkReviewedRequest;
    readonly response: IpcResult<SessionSummary>;
  };
}

export type InvokeChannel = keyof InvokeChannelMap;
export type InvokeRequest<C extends InvokeChannel> = InvokeChannelMap[C]['request'];
export type InvokeResponse<C extends InvokeChannel> = InvokeChannelMap[C]['response'];

/** State of the embedded MCP server. The bearer token never crosses into the renderer. */
export type McpStatus =
  | { readonly state: 'starting' }
  | { readonly state: 'running'; readonly url: string }
  | { readonly state: 'stopped' }
  | { readonly state: 'failed'; readonly message: string };

/** Payloads main pushes to the renderer with `webContents.send`. */
export interface EventChannelMap {
  'mcp:status': McpStatus;
}

export type EventChannel = keyof EventChannelMap;
export type EventPayload<E extends EventChannel> = EventChannelMap[E];

/** Unsubscribes a listener registered with {@link BeuveApi.on}. */
export type Unsubscribe = () => void;

/** The API the preload exposes as `window.beuve`. */
export interface BeuveApi {
  readonly invoke: <C extends InvokeChannel>(
    channel: C,
    ...request: InvokeRequest<C> extends undefined ? [] : [InvokeRequest<C>]
  ) => Promise<InvokeResponse<C>>;
  readonly on: <E extends EventChannel>(
    channel: E,
    listener: (payload: EventPayload<E>) => void,
  ) => Unsubscribe;
}
