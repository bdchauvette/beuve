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
  /** Full blob names of the base and head sides (ADR 0018); absent for a side that doesn't exist. */
  readonly oldBlobSha?: string;
  readonly newBlobSha?: string;
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

export interface GetImpactRequest {
  readonly sessionId: string;
}

/** One function's complexity (ADR 0015). */
export interface FunctionMetricsView {
  readonly cognitive: number;
  readonly cyclomatic: number;
  readonly lines: number;
  readonly maxNesting: number;
  readonly parameters: number;
}

/** Where a function sat on one side of the change. Lines are 1-based and inclusive. */
export interface FunctionSnapshotView {
  readonly startLine: number;
  readonly endLine: number;
  readonly metrics: FunctionMetricsView;
}

interface FunctionImpactViewCommon {
  readonly name: string;
  /** Its lines intersect the diff. */
  readonly inDiff: boolean;
  /** Head minus base, an absent side counting as zeros. */
  readonly delta: FunctionMetricsView;
}

/** How the change moved one function. `percentile` (0–100) ranks the head cognitive value. */
export type FunctionImpactView = FunctionImpactViewCommon &
  (
    | {
        readonly change: 'added';
        readonly head: FunctionSnapshotView;
        readonly percentile: number;
      }
    | { readonly change: 'removed'; readonly base: FunctionSnapshotView }
    | {
        readonly change: 'modified' | 'unchanged';
        readonly base: FunctionSnapshotView;
        readonly head: FunctionSnapshotView;
        readonly percentile: number;
      }
    | {
        readonly change: 'renamed';
        readonly previousName: string;
        readonly base: FunctionSnapshotView;
        readonly head: FunctionSnapshotView;
        readonly percentile: number;
      }
  );

/** Totals for one file of the impact check. */
export interface FileAggregateView {
  readonly baseFunctions: number;
  readonly headFunctions: number;
  readonly baseCognitive: number;
  readonly headCognitive: number;
  readonly cognitiveDelta: number;
  readonly maxCognitive: number;
  readonly changedFunctions: number;
  readonly findings: number;
}

/**
 * Why a file was not analyzed: no rules for its language, a side over the size limit, a parse
 * failure, a binary side, a submodule, or no text on either side.
 */
export type ImpactSkipReason =
  'unsupported-language' | 'too-large' | 'parse-failed' | 'binary' | 'submodule' | 'no-source';

export type FileImpactView =
  | {
      readonly status: 'analyzed';
      readonly path: string;
      readonly previousPath?: string;
      readonly language: string;
      readonly parseErrors: boolean;
      readonly aggregate: FileAggregateView;
      readonly functions: readonly FunctionImpactView[];
    }
  | {
      readonly status: 'skipped';
      readonly path: string;
      readonly previousPath?: string;
      readonly reason: ImpactSkipReason;
    };

/** A changed function over the cognitive limit, and how that compares with the base. */
export interface ImpactFindingView {
  readonly kind: 'cognitive-complexity';
  readonly path: string;
  readonly functionName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly value: number;
  readonly limit: number;
  readonly baseValue?: number;
  readonly trend: 'introduced' | 'worsened' | 'unchanged' | 'improved';
  readonly percentile: number;
}

/**
 * ImpactGate for the diff `session:get-review` shows for the same session, base and head
 * (ADR 0015). Computed on demand and cached per diff, so it never delays the review itself.
 */
export interface ImpactView {
  readonly sessionId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly cognitiveMax: number;
  /** Head functions the percentiles rank against. */
  readonly population: number;
  readonly files: readonly FileImpactView[];
  readonly findings: readonly ImpactFindingView[];
  readonly totals: {
    readonly analyzedFiles: number;
    readonly skippedFiles: number;
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
    readonly cognitiveDelta: number;
    readonly findings: number;
  };
  /** Wall time of the computation that produced this report (blob reads and parsing). */
  readonly computeMs: number;
}

/**
 * Both sides of one file of the review `session:get-review` shows for the session now, for hunk
 * expansion. `path` is the head-side path (the diff's `path`).
 */
export interface GetFilePairRequest {
  readonly sessionId: string;
  readonly path: string;
}

/** A file's full base and head text; a side that doesn't exist (added or deleted) is absent. */
export interface FilePairView {
  readonly path: string;
  readonly oldPath?: string;
  readonly oldContents?: string;
  readonly newContents?: string;
}

export interface GetTreeRequest {
  readonly sessionId: string;
}

/**
 * Every path tracked at the session head, for the radar tree, and the package roots among their
 * directories: those holding a `package.json`, `go.mod`, `Cargo.toml` or `pyproject.toml`. The
 * repository root is `''`. Paths are repository-relative with `/` separators, in git's order.
 */
export interface RepositoryTreeView {
  readonly sessionId: string;
  readonly headSha: string;
  readonly paths: readonly string[];
  readonly packageRoots: readonly string[];
}

/**
 * Call hierarchy for the peek portal, run by the language server against a checkout of the
 * session head. Without `nodeId`, the hierarchy is rooted at the callable at `line` (1-based) and
 * `character` (0-based UTF-16), or, without `character`, at the innermost function, method or
 * constructor enclosing `line`. With `nodeId` (from an earlier answer), that node is expanded.
 */
export interface CallHierarchyRequest {
  readonly sessionId: string;
  /** Repository-relative path with `/` separators. */
  readonly path: string;
  readonly line: number;
  readonly character?: number;
  readonly direction: 'incoming' | 'outgoing';
  readonly nodeId?: string;
}

/**
 * Whether a node's declaration overlaps the lines the review changed on the head side
 * (`modified`), doesn't (`untouched`), or lies outside the repository (`external`).
 */
export type CallHierarchyBadgeView = 'modified' | 'untouched' | 'external';

/** A callable in the hierarchy. Lines are 1-based and inclusive. */
export interface CallHierarchyNodeView {
  /** Pass back as `nodeId` to expand this node. */
  readonly id: string;
  readonly name: string;
  /** `function`, `method`, `constructor`, … */
  readonly kind: string;
  readonly detail?: string;
  readonly file:
    | { readonly kind: 'workspace'; readonly path: string }
    | { readonly kind: 'external'; readonly uri: string };
  readonly startLine: number;
  readonly endLine: number;
  /** Where the name is. */
  readonly selectionLine: number;
  readonly badge: CallHierarchyBadgeView;
}

/** An edge: for incoming calls `node` is a caller, for outgoing a callee. */
export interface CallHierarchyCallView {
  readonly node: CallHierarchyNodeView;
  /** 1-based lines of the call sites. */
  readonly callSiteLines: readonly number[];
}

/** `root` is the node the hierarchy starts at; absent when an existing node was expanded. */
export interface CallHierarchyView {
  readonly direction: 'incoming' | 'outgoing';
  readonly root?: CallHierarchyNodeView;
  readonly calls: readonly CallHierarchyCallView[];
}

/** How hard Claude Code thinks during a preliminary review (`--effort`, ADR 0019). */
export type ReviewEffort = 'low' | 'medium' | 'high';

/**
 * Start the opt-in preliminary agentic review of a session's current head (spec 5B, ADR 0022).
 * `pathPrefixes` limits the review to files at or under these repository-relative paths; `fresh`
 * reruns even when a stored run exists for the head (replacing it); `effort` is passed to Claude
 * Code. Answers at once; progress arrives as `review:progress` events.
 */
export interface ReviewRunRequest {
  readonly sessionId: string;
  readonly pathPrefixes?: readonly string[];
  readonly fresh?: boolean;
  readonly effort?: ReviewEffort;
}

/** Insights validation dropped, by reason (ADR 0019). */
export interface ReviewDropsView {
  /** Not a head-side text file of the reviewed diff. */
  readonly unknownFile: number;
  /** In a diff file but outside every hunk. */
  readonly outsideDiff: number;
  readonly lowConfidence: number;
  readonly duplicate: number;
  readonly overLimit: number;
}

/** A completed preliminary review run of one (session, head). */
export interface ReviewRunSummaryView {
  readonly reviewRunId: string;
  readonly sessionId: string;
  readonly headSha: string;
  readonly scope: 'full' | 'interdiff';
  readonly model: string;
  readonly insightCount: number;
  readonly droppedCount: number;
  /** Per reason, for a run that just finished; stored runs keep only the total. */
  readonly dropped?: ReviewDropsView;
  /** Files sent to the model, for a run that just finished. */
  readonly fileCount?: number;
  readonly pathPrefixes?: readonly string[];
  readonly durationMs?: number;
  /** Claude Code's estimate; notional on subscription logins. */
  readonly costUsd?: number;
  readonly createdAt: string;
}

/**
 * The answer to `review:run`. `started`: a new background run; `attached`: a run for this head was
 * already in flight and the request joined it; `reused`: a stored run exists for the head (pass
 * `fresh` to rerun), and `summary` describes it. `runId` keys the `review:progress` events.
 */
export type ReviewRunHandleView =
  | {
      readonly status: 'started' | 'attached';
      readonly runId: string;
      readonly sessionId: string;
      readonly headSha: string;
    }
  | {
      readonly status: 'reused';
      readonly runId: string;
      readonly sessionId: string;
      readonly headSha: string;
      readonly summary: ReviewRunSummaryView;
    };

/**
 * Why a preliminary review produced nothing. `not-installed`: no `claude` executable was found;
 * `not-authenticated`: Claude Code is logged out; `cancelled`: the head moved, a fresh run replaced
 * it, or beuve quit; `nothing-to-review`: no reviewable change (up to date, or no file under the
 * prefixes); `review-unavailable`: the diff or checkout failed; `model-failed`: Claude Code ran but
 * gave no usable answer.
 */
export type ReviewRunErrorView =
  | { readonly code: 'not-installed'; readonly message: string }
  | { readonly code: 'not-authenticated'; readonly message: string }
  | { readonly code: 'rate-limited'; readonly message: string; readonly resetsAt?: string }
  | { readonly code: 'timeout'; readonly message: string }
  | {
      readonly code: 'cancelled';
      readonly reason: 'head-changed' | 'superseded' | 'app-quit';
      readonly message: string;
    }
  | { readonly code: 'nothing-to-review'; readonly message: string }
  | { readonly code: 'review-unavailable'; readonly message: string }
  | { readonly code: 'model-failed'; readonly message: string };

/** One step of a background review run, pushed on `review:progress`. */
export type ReviewProgressView = {
  readonly runId: string;
  readonly sessionId: string;
  readonly headSha: string;
} & (
  | { readonly kind: 'started' }
  /** Coarse status text; never prompt or file content. */
  | { readonly kind: 'progress'; readonly message: string }
  | { readonly kind: 'completed'; readonly summary: ReviewRunSummaryView }
  | { readonly kind: 'failed'; readonly error: ReviewRunErrorView }
);

/** `pending` until the reviewer promotes (`y`) or dismisses (`d`) the insight. */
export type InsightStatusView = 'pending' | 'promoted' | 'dismissed';

/**
 * One agent insight (spec 5B). Lines are 1-based and inclusive on the head side, and touch a hunk
 * of the diff the run reviewed. `body` is untrusted Markdown from the model: render it as text.
 */
export interface AgentInsightView {
  readonly id: string;
  readonly runId: string;
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly severity: 'info' | 'warning' | 'risk';
  readonly category:
    | 'edge-case'
    | 'security'
    | 'type-mismatch'
    | 'error-handling'
    | 'concurrency'
    | 'scope-creep'
    | 'complexity'
    | 'other';
  readonly title: string;
  readonly body: string;
  /** 0–1. */
  readonly confidence: number;
  readonly status: InsightStatusView;
  readonly model: string;
  readonly createdAt: string;
}

export interface ListInsightsRequest {
  readonly sessionId: string;
}

/** The insights of a session's current head, every status, by path and line. */
export interface InsightListView {
  readonly sessionId: string;
  readonly headSha: string;
  /** The stored run for the head, if any. */
  readonly run?: ReviewRunSummaryView;
  /** A run for this head in flight now, so a reloaded renderer can follow it. */
  readonly activeRunId?: string;
  readonly insights: readonly AgentInsightView[];
}

export interface SetInsightStatusRequest {
  readonly insightId: string;
  readonly status: InsightStatusView;
}

export interface InsightStatusChangeView {
  readonly insightId: string;
  readonly status: InsightStatusView;
}

/**
 * Expected failures of an invoke channel. `not-wired` means the backing service isn't composed
 * yet; `stale-review` that the head moved after the reviewer last saw it; `unsupported` that no
 * language server handles the file, or that a side of a file pair is binary or too large;
 * `lsp-failed` that the language server could not answer.
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
  | 'unsupported'
  | 'lsp-failed'
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
  'session:get-impact': {
    readonly request: GetImpactRequest;
    readonly response: IpcResult<ImpactView>;
  };
  'session:get-file-pair': {
    readonly request: GetFilePairRequest;
    readonly response: IpcResult<FilePairView>;
  };
  'session:get-tree': {
    readonly request: GetTreeRequest;
    readonly response: IpcResult<RepositoryTreeView>;
  };
  'lsp:call-hierarchy': {
    readonly request: CallHierarchyRequest;
    readonly response: IpcResult<CallHierarchyView>;
  };
  'review:run': {
    readonly request: ReviewRunRequest;
    readonly response: IpcResult<ReviewRunHandleView>;
  };
  'review:list-insights': {
    readonly request: ListInsightsRequest;
    readonly response: IpcResult<InsightListView>;
  };
  'review:set-insight-status': {
    readonly request: SetInsightStatusRequest;
    readonly response: IpcResult<InsightStatusChangeView>;
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
  'review:progress': ReviewProgressView;
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
