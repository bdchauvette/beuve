import type { Result } from '#x/result/result.ts';

import type { CommandId, ContextKind, MenuCondition } from './command-catalog.ts';

/**
 * The typed IPC contract between main, preload and ui (ADR 0011). Plain serializable data
 * only: everything here crosses a structured-clone boundary and must stay DOM- and Node-free.
 * Temporal objects do not survive structured clone (`DataCloneError`), so instants are ISO-8601
 * UTC strings and durations are ISO-8601 duration strings (`PT0.712S`, ADR 0059); main converts
 * with `Temporal.Duration#toString` and the UI parses with `Temporal.Duration.from`.
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

/** Which side of the diff the sidebar sits on (ADR 0044). */
export type SidebarSideView = 'left' | 'right';

/** What a session reviews: a local branch, a GitHub pull request or a followed GitHub branch. */
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
      /** The local ref the base branch is fetched into, `refs/beuve/pr/<n>/base`. */
      readonly baseRef: string;
      readonly host: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    }
  | {
      /** A branch on a GitHub remote without a pull request yet (ADR 0112). */
      readonly kind: 'remote-branch';
      readonly repoPath: string;
      /** The local ref the remote's default branch is fetched into, `refs/beuve/branch/<key>/base`. */
      readonly baseRef: string;
      readonly forge: 'github';
      readonly host: string;
      readonly owner: string;
      readonly repo: string;
      readonly branch: string;
    };

/** What the session list shows of a followed branch (ADR 0112). */
export interface RemoteBranchBadgeView {
  /** `gone` once the remote no longer has the branch. */
  readonly state: 'present' | 'gone';
  readonly defaultBranch: string;
}

/** What the session list shows of a pull request, from the metadata main last stored. */
export interface PullRequestBadgeView {
  readonly title: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly isDraft: boolean;
  /** The pull request's base branch on GitHub, e.g. `main`. */
  readonly baseBranch: string;
}

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
  /** Pull request sessions whose metadata main has stored (ADR 0037); `session:list` only. */
  readonly pullRequest?: PullRequestBadgeView;
  /** Remote-branch sessions whose branch main has stored (ADR 0112); `session:list` only. */
  readonly remoteBranch?: RemoteBranchBadgeView;
}

/** Start (or resume) reviewing `headRef` against `baseRef` in the repository containing `repoPath`. */
export interface CreateLocalSessionRequest {
  /** Absolute path inside a git worktree; the session records the repository's top level. */
  readonly repoPath: string;
  readonly baseRef: string;
  readonly headRef: string;
}

/** A folder the reviewer picked, before any session exists for it. */
export interface InspectRepositoryRequest {
  /** Absolute path inside a git worktree. */
  readonly path: string;
}

/** A local or remote-tracking branch by its short name (`main`, `origin/main`). */
export interface BranchView {
  readonly name: string;
  readonly isRemote: boolean;
  readonly committedAt: string;
}

/** The repository containing a folder, with branch suggestions for base and head. */
export interface RepositoryInspectionView {
  readonly root: string;
  /** The checked-out branch; absent on a detached head. */
  readonly currentBranch?: string;
  /** `origin/HEAD`'s target, else `main` or `master`. */
  readonly defaultBase?: string;
  /** Most recently committed first. */
  readonly branches: readonly BranchView[];
}

/** Shows the system folder picker. */
export interface ChooseFolderRequest {
  readonly title?: string;
  /** Absolute path the picker starts in. */
  readonly defaultPath?: string;
}

export type ChooseFolderResponse =
  { readonly kind: 'chosen'; readonly path: string } | { readonly kind: 'cancelled' };

export interface GetReviewRequest {
  readonly sessionId: string;
  /**
   * Diff with `git diff --ignore-all-space` (ADR 0042): a separately cached display variant.
   * Head line numbers, and so every anchor, are the same as without it.
   */
  readonly ignoreWhitespace?: boolean;
}

/**
 * Sign off on the session's current head. `expectedHeadSha` is the head the reviewer was shown
 * (ADR 0078); if the head moved since, nothing is recorded and the call fails with `stale-review`.
 */
export interface MarkReviewedRequest {
  readonly sessionId: string;
  readonly expectedHeadSha: string;
}

/**
 * Marks a file reviewed or not (ADR 0064). `expectedHeadSha` is the head the reviewer was shown
 * (ADR 0078), else the call fails with `stale-review`. `path` is the file's head path in the
 * review diff, else `not-found`.
 */
export interface SetFileReviewedRequest {
  readonly sessionId: string;
  readonly path: string;
  readonly reviewed: boolean;
  readonly expectedHeadSha: string;
}

/**
 * Whether a file is reviewed: `yes` (marked, and its diff is the one that was reviewed, even if
 * the head moved), `no`, or `changed-since` (marked, but its diff differs now; shown, not lost).
 */
export type FileReviewStateView = 'yes' | 'no' | 'changed-since';

/** Reviewed counts over the files of the diff shown. */
export interface FileReviewProgressView {
  readonly total: number;
  readonly reviewed: number;
  readonly changedSince: number;
  readonly unreviewed: number;
}

export interface SetFileReviewedResponse {
  readonly sessionId: string;
  readonly path: string;
  readonly reviewed: FileReviewStateView;
  readonly progress: FileReviewProgressView;
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
        /**
         * `replay` is `commit-pairs` when the whole-range replay conflicted and the reviewed
         * commits that still have a partner were replayed one by one instead (ADR 0054).
         */
        | { readonly kind: 'rebased'; readonly replay?: 'commit-pairs' }
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
  /**
   * The file's `#!` line, for a file whose name has no extension (ADR 0120), so `bin/deploy` can
   * be highlighted by its interpreter. Absent when there is none or the name has an extension.
   */
  readonly shebang?: string;
  /** Reviewed mark state (ADR 0064). Set on every file of a `ReviewView`; absent in commit interdiffs. */
  readonly reviewed?: FileReviewStateView;
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
  /** `ignored` when the diff was computed ignoring whitespace (ADR 0042). */
  readonly whitespace: 'shown' | 'ignored';
  /**
   * For an interdiff: the previously reviewed commits paired with the new ones (ADR 0054), in the
   * new range's order with dropped commits in place. Absent for other scopes, or when either range
   * is too long to pair.
   */
  readonly commitPairs?: readonly CommitPairView[];
  /**
   * For an interdiff with `commitPairs`: which pairs produced each file, aligned with `files`.
   */
  readonly fileAttribution?: readonly FileAttributionView[];
  /**
   * Where this pull request's own changes start when that is not the merge-base with the base
   * branch (ADR 0054): `already-upstream` when its oldest commits are already on the base under
   * other SHAs (a squash- or rebase-merged stack parent), `reviewed-base` when they sit under a fork
   * point already reviewed (a force-pushed parent this branch wasn't rebased onto). `baseSha` is
   * then that fork point.
   */
  readonly forkPoint?: ForkPointView;
  /** Reviewed counts over `files` (ADR 0064); always set by main. */
  readonly reviewProgress?: FileReviewProgressView;
}

/**
 * How a commit of the previously reviewed range relates to one of the new range, like
 * `git range-diff`: `unchanged` (same patch-id, or an empty interdiff), `modified` (paired by
 * similar changed lines), `added` (new only) or `dropped` (previous only).
 */
export interface CommitPairView {
  /** Stable within one review: the new commit's sha, else the previous one's. */
  readonly id: string;
  readonly kind: 'unchanged' | 'modified' | 'added' | 'dropped';
  readonly previous?: CommitSideView;
  readonly next?: CommitSideView;
  /** The new subject, else the previous one. */
  readonly subject: string;
  /** For `modified`: the Dice overlap of the two commits' changed lines, 0–1. */
  readonly similarity?: number;
  /** For `modified`: the previous commit replayed onto the new commit's parent, against it. */
  readonly interdiff?: CommitInterdiffView;
}

export interface CommitSideView {
  readonly sha: string;
  readonly subject: string;
  readonly additions: number;
  readonly deletions: number;
}

export type CommitInterdiffView =
  | { readonly kind: 'clean'; readonly files: readonly DiffFileView[] }
  | { readonly kind: 'conflicts'; readonly paths: readonly string[] }
  | { readonly kind: 'unavailable'; readonly reason: 'too-many-pairs' | 'git-too-old' };

/** The commit pairs (by `CommitPairView.id`) behind one file of the review diff. */
export interface FileAttributionView {
  readonly path: string;
  /** Pairs whose new commit changed this path. */
  readonly pairIds: readonly string[];
  /** Aligned with the file's `hunks`: pairs whose new commit produced lines of that hunk. */
  readonly hunkPairIds: readonly (readonly string[])[];
}

export interface ForkPointView {
  readonly reason: 'already-upstream' | 'reviewed-base';
  /** The merge-base with the base branch, which `baseSha` replaces. */
  readonly mergeBaseSha: string;
  /** Commits between the merge-base and `baseSha` left out of the review. */
  readonly skippedCommits: number;
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

export interface GetFileAttributesRequest {
  readonly sessionId: string;
}

/**
 * What `.gitattributes` at the session head says about the review's files (ADR 0052), by head
 * path (base path for a deleted file): `linguist-generated` set (`generated`) or explicitly
 * unset or `false` (`notGenerated`, which overrides beuve's own guesses), and `-diff` (`noDiff`).
 * Files with none of these are in no list. All lists are empty when git is older than 2.40.
 */
export interface FileAttributesView {
  readonly sessionId: string;
  readonly headSha: string;
  readonly generated: readonly string[];
  readonly notGenerated: readonly string[];
  readonly noDiff: readonly string[];
}

/**
 * Call hierarchy for the peek portal, run by the language server against a checkout of
 * `expectedHeadSha`, the head the reviewer was shown (ADR 0078): when the session's head is no
 * longer that one, the call fails with `stale-review`. Without `nodeId`, the hierarchy is rooted
 * at the callable at `line` (1-based) and `character` (0-based UTF-16), or, without `character`,
 * at the innermost function, method or constructor enclosing `line`. With `nodeId` (from an
 * earlier answer at the same head), that node is expanded.
 */
export interface CallHierarchyRequest {
  readonly sessionId: string;
  readonly expectedHeadSha: string;
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

/**
 * `root` is the node the hierarchy starts at; absent when an existing node was expanded. `headSha`
 * is the commit the answer and its badges describe.
 */
export interface CallHierarchyView {
  readonly headSha: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly root?: CallHierarchyNodeView;
  readonly calls: readonly CallHierarchyCallView[];
}

/**
 * Where the symbol on a line is defined (ADR 0067), asked of the language server in a checkout of
 * `sha` (a commit of the session's repository; the session head when absent). Without
 * `character` (0-based UTF-16), main picks the token: the line's calls first, then its other
 * names, the names it declares last, and falls back to the enclosing symbol's name.
 */
export interface DefinitionRequest {
  readonly sessionId: string;
  readonly sha?: string;
  /** Repository-relative path with `/` separators. */
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  readonly character?: number;
  readonly kind?: 'definition' | 'type-definition';
  /**
   * Ask whether the identifier at `character` (required) links anywhere, for the underline under
   * ⌘/Ctrl-hover (ADR 0105): only that identifier is probed, the enclosing symbol is not a
   * fallback, and a target that is the identifier itself doesn't count. `targets` is empty when
   * nothing links.
   */
  readonly link?: true;
}

/** A place in a file: 1-based lines, 0-based UTF-16 characters, the end exclusive. */
export interface SheetRangeView {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

export interface DefinitionTargetView extends SheetRangeView {
  readonly file:
    | { readonly kind: 'workspace'; readonly path: string }
    | { readonly kind: 'external'; readonly uri: string };
}

/**
 * `token` is what the server was asked about (absent when the enclosing symbol's name was);
 * `targets` is empty when it knows no definition. `sha` is the commit the answer is for.
 */
export interface DefinitionView {
  readonly sha: string;
  readonly token?: SheetRangeView & { readonly text: string };
  readonly targets: readonly DefinitionTargetView[];
}

/**
 * What the language server says about the token at `character` (0-based UTF-16) of 1-based `line`,
 * asked in a checkout of `sha` (the session head when absent), as for {@link DefinitionRequest}.
 * Unlike a definition request, `character` is required: a hover is about where the pointer is.
 */
export interface HoverRequest {
  readonly sessionId: string;
  readonly sha?: string;
  /** Repository-relative path with `/` separators. */
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  readonly character: number;
}

/**
 * The server's hover text. `markdown` is CommonMark the server wrote, to be rendered as untrusted;
 * `range` is the token it is about, when the server said. `hover` is absent when the server has
 * nothing to say there. `sha` is the commit the answer is for.
 */
export interface HoverView {
  readonly sha: string;
  readonly hover?: {
    readonly markdown: string;
    readonly range?: SheetRangeView;
  };
}

/**
 * The language servers' diagnostics for one file (ADR 0111), asked in a checkout of `sha`, which
 * must be the session head: diagnostics exist at the head only. The session head when absent.
 */
export interface DiagnosticsRequest {
  readonly sessionId: string;
  readonly sha?: string;
  /** Repository-relative path with `/` separators. */
  readonly path: string;
}

/** `language-servers:open-config`: the file that was opened, and whether it had to be created. */
export interface OpenedConfigView {
  readonly path: string;
  readonly created: boolean;
}

export type DiagnosticSeverityView = 'error' | 'warning' | 'information' | 'hint';

/**
 * One problem a server reported, at a place in the head's file. `message` is plain text the server
 * wrote, to be shown as untrusted text, never as markup. A server that gave no severity reads as
 * an error, as editors treat it.
 */
export interface DiagnosticItemView extends SheetRangeView {
  readonly severity: DiagnosticSeverityView;
  readonly message: string;
  readonly code?: string;
  /** The tool the server names (such as `ts`), when it does. */
  readonly source?: string;
  /** Which of beuve's language servers reported it. */
  readonly serverId: string;
}

/**
 * - `settled`: the server reported on the current text and went quiet.
 * - `timed-out`: it was still busy at the deadline; `diagnostics` is what it sent so far.
 * - `not-head`: `sha` is not the session head, which has no diagnostics (ADR 0111).
 * - `unavailable`: no server handles this file, or it can't give diagnostics for it.
 * - `untrusted`: the trust check refused to start the server, and `notice` says so.
 */
export type DiagnosticsState = 'settled' | 'timed-out' | 'not-head' | 'unavailable' | 'untrusted';

/** What the servers say about a file at `sha`, the commit the answer is for. */
export interface DiagnosticsView {
  readonly sha: string;
  readonly state: DiagnosticsState;
  /** In file order. Main caps how many reach the renderer, so a runaway server cannot flood it. */
  readonly diagnostics: readonly DiagnosticItemView[];
  /** How many more the servers reported than `diagnostics` holds. */
  readonly omitted: number;
  /**
   * Plain text from beuve, not the server, for the reviewer: why a server was not started, or that
   * the shell environment it runs in could not be read (ADR 0111).
   */
  readonly notice?: string;
}

/**
 * Opens a new sheet (ADR 0067): a read-only window showing `path` as it is at commit `sha`,
 * scrolled to and highlighting `range` (or line 1). Every call opens a new window.
 */
export interface OpenSheetRequest {
  readonly sessionId: string;
  readonly sha: string;
  readonly path: string;
  readonly range?: SheetRangeView;
}

/** A whole file at a commit for a sheet, with what the review changed in it. */
export interface SheetFileRequest {
  readonly sessionId: string;
  readonly sha: string;
  readonly path: string;
}

/**
 * Lines the change made relative to the review base (1-based, inclusive spans): `added` and
 * `modified` lines, and `deletedAt`, the lines a removal sits just above (the last line for a
 * removal at the end of the file).
 */
export interface SheetMarksView {
  readonly added: readonly { readonly startLine: number; readonly endLine: number }[];
  readonly modified: readonly { readonly startLine: number; readonly endLine: number }[];
  readonly deletedAt: readonly number[];
}

/** A staged URA note on the sheet's lines; only for a sheet at the session head. */
export interface SheetNoteView {
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: UraSeverityView;
  readonly title: string;
}

/**
 * `sha` is the commit the sheet is pinned to, `headSha` the session head now and `baseSha` the
 * review base the marks compare against.
 */
export interface SheetFileView {
  readonly sessionId: string;
  readonly sha: string;
  readonly headSha: string;
  readonly baseSha: string;
  readonly path: string;
  readonly contents: string;
  readonly marks: SheetMarksView;
  readonly notes: readonly SheetNoteView[];
}

export interface SheetHeadView {
  readonly sessionId: string;
  readonly headSha: string;
}

/**
 * A permalink (ADR 0067) to `path` at commit `sha` on the session's primary remote: the remote of
 * a pull request's base repository, else `origin`, else the first GitHub remote. Lines are
 * 1-based and inclusive; without them the link is to the whole file.
 */
export interface PermalinkRequest {
  readonly sessionId: string;
  readonly sha: string;
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

/**
 * `link` names the remote it points at; the commit may not be pushed yet, in which case GitHub
 * answers 404 until it is. `no-remote` when the repository has no GitHub remote.
 */
export type PermalinkView =
  | { readonly kind: 'link'; readonly url: string; readonly remote: string }
  | { readonly kind: 'no-remote' };

/**
 * A link (ADR 0108) to commit `sha` on the session's primary remote, chosen as for a permalink.
 * `sha` is a full commit name of the session's repository.
 */
export interface CommitLinkRequest {
  readonly sessionId: string;
  readonly sha: string;
}

/** `session:get-commit` (ADR 0116): commit `sha`, a full commit name of the session's repository. */
export interface GetCommitRequest {
  readonly sessionId: string;
  readonly sha: string;
}

/** Who wrote or committed a commit; `at` is an ISO 8601 instant. */
export interface CommitSignatureView {
  readonly name: string;
  readonly email: string;
  readonly at: string;
}

/** A commit's parents, people and message, for a commit hash's card (ADR 0116). */
export interface CommitInfoView {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly author: CommitSignatureView;
  readonly committer: CommitSignatureView;
  /** The message's first line. */
  readonly subject: string;
  /** The rest of the message, without the blank lines after the subject; empty when none. */
  readonly body: string;
}

/**
 * The control-flow graph of the function enclosing head line `line` (1-based) of `path`, a file
 * of the review `session:get-review` shows for the session now (ADR 0028, 0029).
 */
export interface GetFlowGraphRequest {
  readonly sessionId: string;
  /** Repository-relative head-side path with `/` separators. */
  readonly path: string;
  readonly line: number;
}

export type FlowNodeKindView =
  | 'entry'
  | 'exit'
  | 'block'
  | 'condition'
  | 'loop'
  | 'switch'
  | 'case'
  | 'try'
  | 'catch'
  | 'finally'
  | 'return'
  | 'throw';

export type FlowEdgeKindView =
  | 'next'
  | 'true'
  | 'false'
  | 'case'
  | 'default'
  | 'loop-back'
  | 'break'
  | 'continue'
  | 'exception'
  | 'finally';

/** One step of the function. Lines are 1-based and inclusive; `changed` marks review changes. */
export interface FlowGraphNodeView {
  readonly id: number;
  readonly kind: FlowNodeKindView;
  readonly label: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly changed: boolean;
}

export interface FlowGraphEdgeView {
  readonly from: number;
  readonly to: number;
  readonly kind: FlowEdgeKindView;
}

export interface FlowGraphView {
  /** The function's own or assigned name; empty when it has none. */
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly nodes: readonly FlowGraphNodeView[];
  readonly edges: readonly FlowGraphEdgeView[];
}

/**
 * Why a file has no graph: the language has no flow rules, no function encloses the line, the
 * function has more nodes than a reviewer can read, or the head side is not readable source
 * (deleted, binary, too big to parse).
 */
export type FlowFailureKind =
  'unsupported-language' | 'no-function-at-line' | 'too-large' | 'file-unavailable';

/** The graph, or the reason there is none; unexpected faults are `IpcError`s instead. */
export type FlowGraphResponse =
  | { readonly kind: 'graph'; readonly graph: FlowGraphView }
  | { readonly kind: 'failed'; readonly failure: FlowFailureKind; readonly message: string };

/** `lsp:restart`: stops the language servers of the session head's checkout; they start afresh. */
export interface LspRestartRequest {
  readonly sessionId: string;
}

/** `lsp:restart`'s answer: the head whose checkout's servers were restarted. */
export interface LspRestartedView {
  readonly sessionId: string;
  readonly headSha: string;
}

/** One running or starting language server, as the status bar lists it. */
export interface LspServerView {
  /** The server definition's id, e.g. `typescript`. */
  readonly serverId: string;
  /** The checkout the server runs in. */
  readonly root: string;
  readonly state: 'starting' | 'running' | 'stopping';
  readonly openDocuments: number;
  /** How many times beuve has restarted it. */
  readonly restarts: number;
}

/** `lsp:status`'s answer: every language server beuve has started, whichever session it serves. */
export interface LspStatusView {
  readonly servers: readonly LspServerView[];
}

/** One terminal of a session (ADR 0095). */
export interface TerminalView {
  readonly id: string;
  readonly sessionId: string;
  /** The head whose checkout the terminal runs in; it stays there when the head moves. */
  readonly headSha: string;
  /** The shell's name, e.g. `zsh`. */
  readonly title: string;
  /** Whether the shell is still running; an ended terminal keeps its output until closed. */
  readonly isRunning: boolean;
}

/** `terminal:open`: a new shell in the checkout of the session's head. */
export interface TerminalOpenRequest {
  readonly sessionId: string;
  readonly expectedHeadSha: string;
  readonly cols: number;
  readonly rows: number;
}

/** `terminal:list`: the session's terminals, for a renderer that just loaded. */
export interface TerminalListRequest {
  readonly sessionId: string;
}

/**
 * A terminal and its recent output. `backlogEnd` counts every character the terminal has written
 * up to the end of `backlog`: a `terminal:data` event whose `end` is not past it is already in it.
 */
export interface TerminalBacklogView extends TerminalView {
  readonly backlog: string;
  readonly backlogEnd: number;
}

export interface TerminalListView {
  readonly terminals: readonly TerminalBacklogView[];
}

/** `terminal:write`: keystrokes or a paste, as the terminal would receive them. */
export interface TerminalWriteRequest {
  readonly terminalId: string;
  readonly data: string;
}

/** `terminal:resize`: the panel's size in character cells. */
export interface TerminalResizeRequest {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

/** `terminal:close`: ends the shell if it runs and forgets the terminal. */
export interface TerminalCloseRequest {
  readonly terminalId: string;
}

/** The answer to `terminal:write`, `terminal:resize` and `terminal:close`. */
export interface TerminalAckView {
  readonly terminalId: string;
}

/** `terminal:data`: output, in order. `end` is the terminal's character count after `data`. */
export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
  readonly end: number;
}

/** `terminal:exit`: the shell ended. `signal` is the signal number that ended it, if any. */
export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode: number;
  readonly signal: number | undefined;
}

/** How hard Claude Code thinks during `/review` (`--effort`, ADR 0019). */
export type ReviewEffort = 'low' | 'medium' | 'high';

/** The head-side lines an answer cites (ADR 0031); 1-based and inclusive. */
export interface ChatCitationView {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Why an answer failed: `not-installed`, `not-authenticated`, `rate-limited`, `timeout`,
 * `model-failed` (Claude Code ran but gave no usable answer), `chat-unavailable` (the diff or
 * checkout failed), `nothing-to-review` (`/review` found no changed text file in scope) or
 * `internal`.
 */
export type ChatErrorCode =
  | 'not-installed'
  | 'not-authenticated'
  | 'rate-limited'
  | 'timeout'
  | 'model-failed'
  | 'chat-unavailable'
  | 'nothing-to-review'
  | 'internal';

/** What an assistant message answers: a question, `/review` (ADR 0055) or `/summarize` (ADR 0056). */
export type AnswerKindView = 'answer' | 'review' | 'abstract';

/**
 * One `/review` finding (ADR 0055). Lines are 1-based and inclusive on the head side, and touch a
 * hunk of the reviewed diff. `title` and `body` are untrusted Markdown from the model: render
 * them as text. `check` is what the verification pass said (refuted findings are dropped).
 */
export interface ChatFindingView {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
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
  readonly check: 'confirmed' | 'unconfirmed' | 'unchecked';
}

/** Findings a `/review` answer left out, by reason. */
export interface ChatReviewDropsView {
  /** Not a head-side text file of the reviewed diff. */
  readonly unknownFile: number;
  /** In a diff file but outside every hunk. */
  readonly outsideDiff: number;
  readonly lowConfidence: number;
  readonly duplicate: number;
  readonly overLimit: number;
  /** Refuted by the verification pass. */
  readonly unconfirmed: number;
}

/** The structured part of a completed `/review` answer. */
export interface ChatReviewView {
  readonly findings: readonly ChatFindingView[];
  readonly dropped: ChatReviewDropsView;
  /** The path prefixes it was limited to; empty for the whole change. */
  readonly pathScope: readonly string[];
  readonly fileCount: number;
  /** Whether the verification pass ran (`skipped` for `--no-verify` or no findings). */
  readonly verification: 'verified' | 'skipped' | 'failed';
  /** The earlier answer at the same head and scope this one repeats; `--fresh` reruns. */
  readonly reusedFrom?: string;
}

/**
 * One entry of a session's Q&A transcript (Zone 4), as a list of typed parts (ADR 0072): the same
 * shape whether it was listed or is being streamed. A `done` answer's text parts hold only the
 * `[[path:start-end]]` markers `citations` lists; while it streams they are the raw, unvalidated
 * preview (and `citations` is empty).
 */
export interface ChatMessageView {
  readonly id: string;
  readonly sessionId: string;
  readonly headSha: string;
  /** `summary` is a `/compact` note (ADR 0047): it stands for every message before it. */
  readonly role: 'user' | 'assistant' | 'system-notice' | 'summary';
  /**
   * In order. A question is text and mention parts, a notice or summary one text part, an
   * answer text, reasoning, tool calls, `/review` findings and, when it failed, an error.
   */
  readonly parts: readonly ChatPartView[];
  readonly citations: readonly ChatCitationView[];
  /** Only answers are ever anything but `done`. */
  readonly status: ChatStatusView;
  /** Set on assistant messages. */
  readonly answerKind?: AnswerKindView;
  /** A completed `/review` answer's findings; its `finding` parts point into them. */
  readonly review?: ChatReviewView;
  readonly createdAt: string;
}

/**
 * Where a chat request stands (ADR 0072): `queued` behind the session's running request (ADR
 * 0057), `submitted` once it runs and before any part arrived, `streaming` while parts arrive,
 * then `done`, `error` or `cancelled`. Cancel works in every state before the last three.
 */
export type ChatStatusView = 'queued' | 'submitted' | 'streaming' | 'done' | 'error' | 'cancelled';

/**
 * One typed piece of a chat message (ADR 0072); `id` is unique within the message and never
 * reused. `text` is untrusted Markdown (render it as text nodes); `reasoning` says the model
 * thought, with a short content-free `summary` when the backend gives one; a `tool-call` names
 * what a read-only tool looked at (`read src/auth.ts:1-40`), never what it found; a `mention` is
 * lines attached to a question, where the question names them; a `finding` is the n-th (0-based)
 * of the message's `review.findings`; an `error` says why the request failed and what to do.
 */
export type ChatPartView =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'reasoning';
      readonly id: string;
      readonly state: 'running' | 'done';
      readonly summary?: string;
    }
  | {
      readonly kind: 'tool-call';
      readonly id: string;
      readonly tool: string;
      readonly description: string;
      /** `stopped`: the request ended before the tool answered. */
      readonly state: 'running' | 'done' | 'failed' | 'stopped';
    }
  | { readonly kind: 'mention'; readonly id: string; readonly mention: ChatMentionView }
  | { readonly kind: 'finding'; readonly id: string; readonly finding: number }
  | {
      readonly kind: 'error';
      readonly id: string;
      readonly code: ChatErrorCode;
      readonly message: string;
    };

/**
 * Lines the reviewer attached to a question (ADR 0046): one side of a file at a commit, 1-based
 * and inclusive, or the whole file without lines. `sha` is the session head for `head`, the
 * review's base for `base`; `path` is that side's own path.
 */
export interface ChatMentionView {
  readonly path: string;
  readonly side: 'head' | 'base';
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sha: string;
}

/** What the reviewer is looking at in the diff stream when asking. */
export interface ChatFocusRequest {
  readonly path: string;
  readonly line?: number;
}

/**
 * A chat command that runs as a request, in place of a question: `/review` (findings, verified by
 * a second pass unless `verify` is false, ADR 0055) or `/summarize` (ADR 0056).
 */
export type ChatCommandRequest =
  | {
      readonly kind: 'review';
      readonly pathPrefixes?: readonly string[];
      /** Rerun even when an earlier answer reviewed the same head and scope. */
      readonly fresh?: boolean;
      readonly effort?: ReviewEffort;
      /** Defaults to true. */
      readonly verify?: boolean;
    }
  | { readonly kind: 'summarize' };

/**
 * Asks a read-only question about the session's current change (ADR 0031), or runs a chat
 * `command`. Answers at once with the stored question and the answer, `streaming` or, while the
 * session runs another request, `queued` (ADR 0057): requests run one at a time, in order, at most
 * 10 waiting (more is `refused`). The answer's parts and status changes arrive on `chat:stream`.
 */
export interface ChatAskRequest {
  readonly sessionId: string;
  /** May name `mentions` as `[[@1]]`, `[[@2]]`…, in order. For a command, what was typed. */
  readonly question: string;
  readonly command?: ChatCommandRequest;
  readonly focus?: ChatFocusRequest;
  /**
   * At most 8, about 20 000 lines together. Main reads each at its commit and puts the exact
   * text first in the prompt; a mention it can't resolve refuses the question (`invalid-request`).
   */
  readonly mentions?: readonly ChatMentionView[];
}

export interface ChatAskedView {
  readonly question: ChatMessageView;
  readonly answer: ChatMessageView;
}

export interface ChatListRequest {
  readonly sessionId: string;
}

/** The session's whole transcript, oldest first. */
export interface ChatListView {
  readonly sessionId: string;
  readonly messages: readonly ChatMessageView[];
}

/**
 * Stops one answer, streaming or queued (ADR 0057; the rest of the queue goes on), or with
 * `sessionId` the session's `/compact`.
 */
export type ChatCancelRequest = { readonly messageId: string } | { readonly sessionId: string };

/** `cancelled` is false when nothing of that was running. */
export interface ChatCancelledView {
  readonly cancelled: boolean;
}

/**
 * Deletes the session's transcript, stopping the request in flight and emptying the queue; with
 * `queuedOnly`, deletes only the questions still queued and their answers (ADR 0057).
 */
export interface ChatClearRequest {
  readonly sessionId: string;
  readonly queuedOnly?: boolean;
}

export interface ChatClearedView {
  readonly removed: number;
}

/**
 * Pushed on `chat:stream` while chat requests run (ADR 0072), keyed by message id and, for parts,
 * part id. `status` says a request was taken from the queue (`submitted`) or its first part
 * arrived (`streaming`), with `activity` as a coarse status line (`/review`'s, never content). A
 * part starts (a text part empty), a text part grows by `text-delta`s in order, a part ends with
 * its final state, or a text part is discarded (the model wrote it before a tool call; its final
 * answer is the last turn's). `message` is the stored message, authoritative: it replaces what
 * the events built, and it is how a request ends (`done`, `error`, `cancelled`) or leaves the
 * queue unstarted. A text part's deltas, from its `part-start` to its `part-end`, `part-discard`
 * or the message's end, concatenate to its text, so they map onto a `ReadableStream<string>`.
 */
export type ChatStreamEvent = { readonly sessionId: string; readonly messageId: string } & (
  | {
      readonly type: 'status';
      readonly status: 'submitted' | 'streaming';
      readonly activity?: string;
    }
  | { readonly type: 'part-start'; readonly part: ChatPartView }
  | { readonly type: 'text-delta'; readonly partId: string; readonly text: string }
  | { readonly type: 'part-end'; readonly part: ChatPartView }
  | { readonly type: 'part-discard'; readonly partId: string }
  | {
      readonly type: 'message';
      readonly message: ChatMessageView;
      /** Earlier turns the prompt had to drop for size, so the drawer can suggest `/compact`. */
      readonly droppedTurns?: number;
    }
);

/** Condenses the session's conversation into a summary message (ADR 0047). */
export interface ChatCompactRequest {
  readonly sessionId: string;
}

/**
 * How `/compact` ended. `compacted` carries the stored summary; `failed` says why, as answers do.
 * It waits its turn in the session's queue (ADR 0057); `chat:cancel { sessionId }` stops it.
 */
export type ChatCompactedView =
  | { readonly outcome: 'compacted'; readonly summary: ChatMessageView }
  | { readonly outcome: 'cancelled' }
  | {
      readonly outcome: 'failed';
      readonly errorCode: ChatErrorCode;
      readonly errorMessage: string;
    };

/** How much a URA item matters, most urgent first (ADR 0023). */
export type UraSeverityView = 'blocker' | 'issue' | 'question' | 'nit' | 'praise';

/** Where a URA item points on a head: lines are 1-based and inclusive. */
export type UraAnchorView =
  | {
      readonly kind: 'lines';
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'change' };

/** Who or what raised a URA item. */
export type UraOriginView =
  | { readonly kind: 'human' }
  /** A chat answer, or with `finding` the n-th (0-based) finding of a `/review` answer. */
  | { readonly kind: 'chat-answer'; readonly messageId: string; readonly finding?: number };

/** `staged` items are exported; `addressed` records the head at which the issue was fixed. */
export type UraStatusView =
  | { readonly kind: 'staged' }
  | { readonly kind: 'withdrawn' }
  | {
      readonly kind: 'addressed';
      readonly atSha: string;
      readonly by: 'reviewer' | 'agent';
    };

/** Why an item no longer maps onto the session's current head. */
export type UraOutdatedReasonView = 'lines-changed' | 'file-deleted' | 'no-line-mapping';

/** Where an item sits on the session's current head (re-anchored when written against an older one). */
export type UraPlacementView =
  | { readonly kind: 'current'; readonly anchor: UraAnchorView }
  | { readonly kind: 'outdated'; readonly reason: UraOutdatedReasonView };

/**
 * One item of the URA staging dock (Zone 3). `anchor` is on `headSha`, the head it was written
 * against; `placement` is where it sits on the session's current head. `body` is Markdown.
 */
export interface UraItemView {
  readonly id: string;
  readonly sessionId: string;
  readonly headSha: string;
  readonly anchor: UraAnchorView;
  readonly placement: UraPlacementView;
  readonly severity: UraSeverityView;
  readonly origin: UraOriginView;
  readonly title: string;
  readonly body: string;
  /** A unified diff for the anchored path, against `headSha`. */
  readonly suggestedPatch?: string;
  readonly status: UraStatusView;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set once a posted GitHub review carried the item (ADR 0039); it is not posted again. */
  readonly posted?: UraPostingView;
}

export interface UraPostingView {
  readonly url: string;
  readonly placement: 'inline' | 'body';
  readonly postedAt: string;
}

/** What the review asks of the author, as a GitHub review event would say it. */
export type UraVerdictView = 'approve' | 'request-changes' | 'comment';

export interface ListUraItemsRequest {
  readonly sessionId: string;
}

/** A session's items in dock order, every status, placed on its current head. */
export interface UraListView {
  readonly sessionId: string;
  readonly headSha: string;
  readonly items: readonly UraItemView[];
  /** The verdict the staged items imply (ADR 0023). */
  readonly derivedVerdict: UraVerdictView;
  /** The verdict the reviewer chose over the derived one; absent when they follow it (ADR 0029). */
  readonly chosenVerdict?: UraVerdictView;
  /** Why a chosen verdict was dropped, until the reviewer chooses again. */
  readonly verdictNotice?: string;
}

/**
 * Stores the verdict the reviewer picks for the session (ADR 0029); exports and
 * `beuve_read_human_review` use it. Omitting `verdict` (or passing the derived one) goes back to
 * following the derived verdict. Approving while a blocker is staged is `refused`. The choice
 * belongs to `expectedHeadSha`, the head the reviewer was shown (ADR 0045, 0078); if the head
 * moved since, nothing is stored and the call fails with `stale-review`.
 */
export interface SetUraVerdictRequest {
  readonly sessionId: string;
  readonly verdict?: UraVerdictView;
  readonly expectedHeadSha: string;
}

/** The verdict state after a change: what exports will carry, and why. */
export interface UraVerdictStateView {
  readonly sessionId: string;
  readonly derivedVerdict: UraVerdictView;
  readonly chosenVerdict?: UraVerdictView;
  readonly verdictNotice?: string;
}

/**
 * A reviewer's note. `headSha` is the head the reviewer was shown, which `anchor` refers to; it
 * defaults to the session's current head. An empty `suggestedPatch` means none.
 */
export interface CreateUraItemRequest {
  readonly sessionId: string;
  readonly headSha?: string;
  readonly anchor: UraAnchorView;
  readonly severity: UraSeverityView;
  readonly title: string;
  readonly body: string;
  readonly suggestedPatch?: string;
  /** Defaults to a note the reviewer wrote (`human`); `chat-answer` stages a chat answer. */
  readonly origin?: { readonly kind: 'chat-answer'; readonly messageId: string };
}

/** Edits an item's text, severity or patch; an empty `suggestedPatch` removes the patch. */
export interface UpdateUraItemRequest {
  readonly itemId: string;
  readonly severity?: UraSeverityView;
  readonly title?: string;
  readonly body?: string;
  readonly suggestedPatch?: string;
}

/**
 * Withdraws an item, marks it addressed (by the reviewer, at the session's current head), or
 * restages it.
 */
export interface TransitionUraItemRequest {
  readonly itemId: string;
  readonly to: 'staged' | 'withdrawn' | 'addressed';
}

/** Every item of the session (any status), exactly once, in the new dock order. */
export interface ReorderUraItemsRequest {
  readonly sessionId: string;
  readonly itemIds: readonly string[];
}

export interface UraOrderView {
  readonly sessionId: string;
  readonly itemIds: readonly string[];
}

/**
 * Stages the n-th (0-based) finding of a completed `/review` answer (ADR 0055) on its lines; main
 * reads the finding from the stored answer. Staging it again returns the item it already has,
 * restaged if it was withdrawn.
 */
export interface StageReviewFindingRequest {
  readonly messageId: string;
  readonly finding: number;
  readonly severity?: UraSeverityView;
}

/** The item a promotion or staging produced; `created` is false when it already existed. */
export interface UraStagedView {
  readonly item: UraItemView;
  readonly created: boolean;
}

/**
 * Where an export goes: `agent-json` (the `beuve.ura/1` payload `beuve_read_human_review`
 * returns), `agent-xml` (the same as XML, for pasting into Claude Code), `github` (the body of a
 * pull request review, not posted).
 */
export type UraExportTarget = 'agent-json' | 'agent-xml' | 'github';

/**
 * Compiles the staged items on the current head with the session's chosen verdict (else the
 * derived one); `verdict` overrides both for this export only.
 */
export interface ExportUraRequest {
  readonly sessionId: string;
  readonly target: UraExportTarget;
  readonly verdict?: UraVerdictView;
}

export interface UraExportView {
  readonly sessionId: string;
  readonly headSha: string;
  readonly target: UraExportTarget;
  readonly mediaType: 'application/json' | 'application/xml';
  readonly text: string;
  readonly verdict: UraVerdictView;
  readonly verdictSource: 'derived' | 'chosen';
  readonly derivedVerdict: UraVerdictView;
  readonly itemCount: number;
  readonly outdatedCount: number;
}

/** Text for the system clipboard, written by main (the renderer's clipboard is denied). */
export interface WriteClipboardRequest {
  readonly text: string;
}

/** Editors beuve can open a file in (ADR 0033). */
export type EditorId = 'zed' | 'vscode' | 'cursor';

/**
 * Opens a head-side file at a line in the reviewer's editor. `path` is repository-relative, with
 * `/` separators and no `..`; `line` and `column` are 1-based.
 */
export interface EditorOpenRequest {
  readonly sessionId: string;
  readonly path: string;
  readonly line: number;
  readonly column?: number;
}

export type EditorOpenFailure = 'no-editor-found' | 'file-unavailable' | 'launch-failed';

/**
 * `opened` says which editor and which copy of the file: `working-tree` is the reviewer's own
 * checkout, `beuve-checkout` the head worktree beuve manages (ADR 0020). `failed` is an expected
 * failure with a message for the status bar.
 */
export type EditorOpenResponse =
  | {
      readonly kind: 'opened';
      readonly editorId: EditorId;
      readonly editorName: string;
      readonly location: 'working-tree' | 'beuve-checkout';
      readonly path: string;
      readonly line: number;
      /** The commit of the checkout the file was opened in: the session head. */
      readonly headSha: string;
    }
  | { readonly kind: 'failed'; readonly failure: EditorOpenFailure; readonly message: string };

export interface EditorChoiceView {
  readonly id: EditorId;
  readonly name: string;
  readonly installed: boolean;
}

/** The editor preference and what is installed, in order of preference. */
export interface EditorSettingsView {
  /** Absent until the reviewer chooses; then the first installed editor is used. */
  readonly preferred?: EditorId;
  readonly editors: readonly EditorChoiceView[];
  /** What review-edits branch names start with (ADR 0088); `review/` by default. */
  readonly reviewEditsPrefix: string;
}

export interface SetPreferredEditorRequest {
  readonly editorId: EditorId;
}

/** Sets the review-edits branch prefix; checked with `git check-ref-format` when a branch is made. */
export interface SetReviewEditsPrefixRequest {
  readonly prefix: string;
}

/** Names a session whose review edits to read or act on (ADR 0088). */
export interface ReviewEditsRequest {
  readonly sessionId: string;
}

/**
 * A session's review edits (ADR 0088): the local branch beuve made for them (or would make),
 * where its writable worktree is, the head it starts from, and how much work it holds: files that
 * differ from that head (committed, uncommitted or untracked) and commits beyond it.
 */
export interface ReviewEditsView {
  readonly sessionId: string;
  readonly branch: string;
  readonly exists: boolean;
  /** The worktree directory, when it is on disk. */
  readonly path?: string;
  /** The reviewed head the branch started at. */
  readonly baseSha?: string;
  /** The base is the session's current head; otherwise suggestions anchor to the older head. */
  readonly isOnSessionHead: boolean;
  readonly files: number;
  readonly commits: number;
}

/** Opens the review-edits worktree in the editor, creating it on first use; at a file if given. */
export interface OpenReviewEditsRequest {
  readonly sessionId: string;
  readonly path?: string;
  readonly line?: number;
}

/** Where Open Review Edits opened, and whether it made the branch just now. */
export interface ReviewEditsOpenedView {
  readonly editorName: string;
  readonly branch: string;
  readonly path: string;
  readonly created: boolean;
}

/** One edit as Turn Edits into Suggestions would stage it. */
export interface ReviewEditPreviewView {
  readonly action: 'create' | 'attach' | 'update' | 'unchanged';
  readonly kind: 'suggestion' | 'note';
  readonly anchor: UraAnchorView;
  readonly title: string;
  /** The suggested patch, or the note's diff, to preview. */
  readonly diff: string;
}

/** The harvest's plan; staging must name `digest`, so only what was previewed is staged. */
export interface ReviewEditsPlanView {
  readonly sessionId: string;
  readonly branch: string;
  /** The head the items are written against: the edits' base. */
  readonly headSha: string;
  readonly digest: string;
  readonly edits: readonly ReviewEditPreviewView[];
}

export interface StageReviewEditsRequest {
  readonly sessionId: string;
  readonly digest: string;
}

/** How many items staging created, attached a suggestion to, updated, or left alone. */
export interface ReviewEditsStagedView {
  readonly created: number;
  readonly attached: number;
  readonly updated: number;
  readonly unchanged: number;
}

/** What Discard Review Edits would lose; discarding must name `digest`. */
export interface ReviewEditsDiscardView {
  readonly sessionId: string;
  readonly branch: string;
  readonly digest: string;
  readonly commits: number;
  /** Paths that differ from the base, committed or not. */
  readonly files: readonly string[];
}

export interface DiscardReviewEditsRequest {
  readonly sessionId: string;
  readonly digest: string;
}

/** Discard Review Edits removed the worktree and the branch. */
export interface ReviewEditsDiscardedView {
  readonly branch: string;
}

/** How a diff card lays out a modification: side by side, or one inline column (ADR 0042). */
export type DiffLayoutView = 'split' | 'unified';

/** The reviewer's display preferences, kept in `settings.json` (ADR 0042, 0044). */
export interface DiffDisplayView {
  readonly layout: DiffLayoutView;
  readonly ignoreWhitespace: boolean;
  readonly sidebarSide: SidebarSideView;
  /** Whether generated files (`linguist-generated`, ADR 0052) render expanded; collapsed by default. */
  readonly showGenerated: boolean;
  /** Whether `/review` findings show as insights on the diff lines (ADR 0061); on by default. */
  readonly showInsights: boolean;
  /** Whether language-server diagnostics show as underlines and counts (ADR 0111); on by default. */
  readonly showDiagnostics: boolean;
  /** The saved `session:get-order` mode (ADR 0065); `path` until chosen. Always set by main. */
  readonly reviewOrder?: ReviewOrderMode;
  /** Whether `j`/`k` pass over files marked reviewed (ADR 0064); off until chosen. Always set by main. */
  readonly skipReviewed?: boolean;
  /** The review queue's sort, grouping and filters (ADR 0113). Always set by main. */
  readonly reviewQueue?: ReviewQueuePrefsView;
  /** Branch name prefixes the review queue lists agent branches for (ADR 0113). Always set by main. */
  readonly reviewQueueBranchPrefixes?: readonly string[];
  /** The preferred code font, a `font-family` list, before Commit Mono (ADR 0122); empty for none. Always set by main. */
  readonly fontFamilyMono?: string;
  /** The preferred interface font, a `font-family` list, before the system font (ADR 0122); empty for none. Always set by main. */
  readonly fontFamilySans?: string;
}

/** Changes some preferences; what is left out stays as it was. */
export interface SetDiffDisplayRequest {
  readonly layout?: DiffLayoutView;
  readonly ignoreWhitespace?: boolean;
  readonly sidebarSide?: SidebarSideView;
  readonly showGenerated?: boolean;
  readonly showInsights?: boolean;
  readonly showDiagnostics?: boolean;
  readonly reviewOrder?: ReviewOrderMode;
  readonly skipReviewed?: boolean;
  readonly reviewQueue?: ReviewQueuePrefsView;
  readonly reviewQueueBranchPrefixes?: readonly string[];
  readonly fontFamilyMono?: string;
  readonly fontFamilySans?: string;
}

/**
 * How the review's files are ordered (ADR 0065): `path` alphabetical, `imports` dependencies before
 * the files that import them, `calls` the same over the language server's outgoing calls.
 */
export type ReviewOrderMode = 'path' | 'imports' | 'calls';

/** `session:get-order`; without `mode` the saved preference applies. */
export interface GetReviewOrderRequest {
  readonly sessionId: string;
  readonly mode?: ReviewOrderMode;
}

/** Why a file sits in the config and mechanical group at the end. */
export type MechanicalReasonView =
  'lockfile' | 'generated' | 'formatting-only' | 'pure-rename' | 'config';

/** One run of the ordered list. `reasons`, for the config group, is aligned with `paths`. */
export interface ReviewOrderGroupView {
  readonly id: 'docs' | 'changes' | 'config-and-mechanical';
  readonly label: string;
  readonly paths: readonly string[];
  readonly reasons?: readonly MechanicalReasonView[];
}

/** Why the order is not the one asked for. */
export type ReviewOrderFallbackView =
  | { readonly kind: 'no-language-server' }
  | { readonly kind: 'no-call-edges' }
  | { readonly kind: 'no-source-files' };

/**
 * The review's files (head paths, as in `ReviewView.files`) in reading order: `groups` in order,
 * `paths` their concatenation. `mode` is what was used; when it differs from `requestedMode`,
 * `fallback` says why.
 */
export interface ReviewOrderView {
  readonly sessionId: string;
  readonly headSha: string;
  readonly requestedMode: ReviewOrderMode;
  readonly mode: ReviewOrderMode;
  readonly fallback?: ReviewOrderFallbackView;
  readonly paths: readonly string[];
  readonly groups: readonly ReviewOrderGroupView[];
}

/** Pushed whenever a session's URA items change (from the dock or a moved head). */
export interface UraChangedView {
  readonly sessionId: string;
}

/** `github:auth-status`: whose GitHub credential beuve would use for `host` (default github.com). */
export interface GithubAuthStatusRequest {
  readonly host?: string;
}

/**
 * Who beuve is signed in to GitHub as, through which mechanism (ADR 0034). Never a token. A
 * `signed-out` status names the reason and, when there is one, a command that fixes it.
 */
export type GithubAuthStatusView =
  | {
      readonly kind: 'signed-in';
      readonly host: string;
      readonly provider: 'gh-cli';
      /** Absent when the provider can't say (an old gh). */
      readonly login?: string;
      readonly scopes?: readonly string[];
      /** The provider's last check of the credential failed, with its message. */
      readonly problem?: string;
    }
  | {
      readonly kind: 'signed-out';
      readonly host: string;
      readonly reason:
        | 'invalid-host'
        | 'cli-not-installed'
        | 'not-logged-in'
        | 'host-not-configured'
        | 'timeout'
        | 'command-failed';
      readonly message: string;
      readonly remedy?: string;
    };

/** A pull request as the UI shows it. `body` is Markdown, rendered with a safe subset. */
export interface PullRequestView {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly isDraft: boolean;
  readonly author: string;
  readonly htmlUrl: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly isCrossRepository: boolean;
  readonly updatedAt: string;
}

/** `github:get-timeline`: the pull request session whose history to read (ADR 0110). */
export interface GetTimelineRequest {
  readonly sessionId: string;
}

/** A submitted review's verdict, as the timeline names it. */
export type TimelineVerdictView = 'approved' | 'changes-requested' | 'commented' | 'dismissed';

/** One commit pushed to the pull request. */
export interface CommitTimelineEventView {
  readonly kind: 'commit';
  readonly sha: string;
  /** The first line of the commit message. */
  readonly headline: string;
  readonly author: string;
  /** An ISO 8601 instant. */
  readonly at: string;
  /** The commit's page on GitHub. */
  readonly url: string;
}

/** A submitted review; `body` is untrusted Markdown and may be empty. */
export interface ReviewTimelineEventView {
  readonly kind: 'review';
  readonly verdict: TimelineVerdictView;
  readonly author: string;
  readonly body: string;
  readonly at: string;
  readonly url: string;
}

/** A comment in the pull request's conversation; `body` is untrusted Markdown. */
export interface CommentTimelineEventView {
  readonly kind: 'comment';
  readonly author: string;
  readonly body: string;
  readonly at: string;
  readonly url: string;
}

export type TimelineEventView =
  CommitTimelineEventView | ReviewTimelineEventView | CommentTimelineEventView;

/** A pull request's history, oldest first; `isTruncated` when GitHub had more than was read. */
export interface PullRequestTimelineView {
  readonly kind: 'timeline';
  readonly events: readonly TimelineEventView[];
  readonly isTruncated: boolean;
}

/** A neighbour in a stack of pull requests, opened with `github:open-pr` and the same clone. */
export interface PullRequestStackEntryView {
  readonly ref: string;
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly htmlUrl: string;
}

export interface PullRequestStackView {
  readonly parents: readonly PullRequestStackEntryView[];
  readonly children: readonly PullRequestStackEntryView[];
}

export type CiBucketView = 'pending' | 'success' | 'failure' | 'neutral';

export interface CiCheckView {
  readonly name: string;
  readonly bucket: CiBucketView;
  readonly url?: string;
}

/** CI for the pull request's head: one rollup over its check runs and commit statuses. */
export interface CiStatusView {
  readonly sha: string;
  readonly overall: CiBucketView | 'none';
  readonly counts: Readonly<Record<CiBucketView, number>>;
  readonly checks: readonly CiCheckView[];
  readonly isTruncated: boolean;
}

/**
 * Open (or resume) a pull request session. `ref` is a pull request URL, `owner/repo#n` or
 * `host/owner/repo#n`; `repoPath` a local clone whose remotes include the pull request's base
 * repository. Without it, main uses the clone last used for that repository (ADR 0037).
 */
export interface OpenPullRequestRequest {
  readonly ref: string;
  readonly repoPath?: string;
  /** Names this request for `request:cancel` (ADR 0079): fetching a large pull request takes a while. */
  readonly requestId?: string;
}

/**
 * Follow (or resume following) a branch on GitHub that may have no pull request (ADR 0112). `ref`
 * is a tree URL (`https://github.com/o/r/tree/<branch>`), `owner/repo:branch` or
 * `host/owner/repo:branch`; `repoPath` a local clone with a remote for that repository. Without
 * it, main uses the clone last used for that repository (ADR 0037).
 */
export interface OpenRemoteBranchRequest {
  readonly ref: string;
  readonly repoPath?: string;
  /** Names this request for `request:cancel` (ADR 0079). */
  readonly requestId?: string;
}

/**
 * A followed branch as main last saw it (ADR 0112). `pullRequest` is the open pull request for
 * the branch, in the branch's repository or, for a fork, an upstream (`owner/repo`), while the
 * session can't become its session: another session already reviews it (`sessionId`), or the
 * clone has no remote for `owner/repo` (`needsRemote`; adding one promotes it on a later poll).
 * Otherwise the session was promoted to it. `agentSessionUrl` is the head commit's
 * `Claude-Session` trailer, an https URL.
 */
export interface RemoteBranchView {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly headSha: string;
  readonly state: 'present' | 'gone';
  readonly htmlUrl: string;
  readonly pullRequest?: {
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
    readonly htmlUrl: string;
    readonly sessionId?: string;
    readonly needsRemote?: boolean;
  };
  readonly agentSessionUrl?: string;
}

export type OpenRemoteBranchResponse =
  | GithubFailureView
  | {
      readonly kind: 'opened';
      readonly session: SessionSummary;
      /**
       * Absent when the branch already had an open pull request and no branch session, so its
       * pull request was opened instead (`session` is then that pull request's session).
       */
      readonly branch?: RemoteBranchView;
      /** The clone's top level, remembered for this repository. */
      readonly repoPath: string;
    };

/** `github:get-branch`: the open branch session's branch. Asking makes it the polled session. */
export interface RemoteBranchSessionView {
  readonly sessionId: string;
  readonly branch: RemoteBranchView;
}

/**
 * Pushed when polling finds a followed branch changed: a new head (`headMoved`), gone or back,
 * a pull request found, or the session promoted to that pull request's session (`promoted`;
 * the renderer then reloads it as a pull request).
 */
export interface RemoteBranchUpdatedView {
  readonly sessionId: string;
  readonly branch: RemoteBranchView;
  readonly headMoved: boolean;
  readonly promoted: boolean;
}

/**
 * `request:cancel` (ADR 0079): stops the calling window's outstanding request that carried this
 * `requestId`. The request then answers `cancelled`, which the renderer drops quietly.
 */
export interface CancelRequestRequest {
  readonly requestId: string;
}

/** Whether a request with that id was still outstanding. */
export interface RequestCancelledView {
  readonly cancelled: boolean;
}

/**
 * Why a GitHub operation didn't happen; `remedy` is a command to run, when one helps. `head-moved`
 * means the session's head is no longer the one the reviewer was shown (ADR 0078).
 */
export type GithubFailureKind =
  | 'invalid-ref'
  | 'not-signed-in'
  | 'not-found'
  | 'forbidden'
  | 'rate-limited'
  | 'needs-local-clone'
  | 'fetch-failed'
  | 'head-mismatch'
  | 'not-a-pull-request'
  | 'own-pull-request'
  | 'stale-commit'
  | 'head-moved'
  | 'github-failed';

export interface GithubFailureView {
  readonly kind: 'failed';
  readonly failure: GithubFailureKind;
  readonly message: string;
  readonly remedy?: string;
}

export type OpenPullRequestResponse =
  | GithubFailureView
  | {
      readonly kind: 'opened';
      readonly session: SessionSummary;
      readonly pullRequest: PullRequestView;
      /** The clone's top level, remembered for this repository. */
      readonly repoPath: string;
    };

/**
 * What the UI shows of a pull request session: stored metadata, its stack neighbours and the last
 * CI status. Asking also makes it the session main polls (ADR 0038).
 */
export interface PullRequestSessionView {
  readonly sessionId: string;
  readonly pullRequest: PullRequestView;
  readonly stack: PullRequestStackView;
  readonly ci?: CiStatusView;
  /** Whose turn it is, once polling has read the reviews (ADR 0066). */
  readonly attention?: AttentionView;
}

/**
 * Post (or preview) the session's staged URA items as one GitHub review on `expectedHeadSha`, the
 * head the reviewer was shown (ADR 0078). If the session's head is no longer that one, nothing is
 * compiled or sent and the answer is the `head-moved` failure. Otherwise main uses that one SHA for
 * the diff, the artifact, `commit_id` and the recorded postings.
 */
export interface PostGithubReviewRequest {
  readonly sessionId: string;
  readonly verdict?: UraVerdictView;
  readonly expectedHeadSha: string;
  /** The reviewer's text for the top of the review body, in place of the generated summary. */
  readonly summary?: string;
}

/**
 * What posting would send: inline comments, items that go into the review body (file-level,
 * whole-change, outdated or off the pull request's diff), and items an earlier review already
 * carried, which are not sent again.
 */
export interface GithubReviewPreviewView {
  readonly sessionId: string;
  readonly headSha: string;
  readonly verdict: UraVerdictView;
  /** The generated top of the review body, which the reviewer may rewrite before posting. */
  readonly summary: string;
  readonly inlineCount: number;
  readonly bodyCount: number;
  readonly alreadyPostedCount: number;
}

export type PostGithubReviewResponse =
  | (GithubReviewPreviewView & {
      readonly kind: 'posted';
      readonly url: string;
      /** Inline comments GitHub refused and the fallback moved into the body. */
      readonly movedToBody: number;
    })
  | GithubFailureView;

/** A link from a pull request body; main opens it in the browser only if it is on GitHub. */
export interface OpenGithubLinkRequest {
  readonly url: string;
}

/** A link from a chat answer; main opens any absolute `http:` or `https:` URL in the browser. */
/** `clipboard:write-text`'s answer: how many UTF-16 code units were written. */
export interface ClipboardWrittenView {
  readonly length: number;
}

/** `menu:set-state`'s answer. */
export interface MenuStateAppliedView {
  readonly applied: true;
}

/** `menu:context`'s answer: whether a menu opened (an empty one doesn't). */
export interface ContextMenuShownView {
  readonly shown: boolean;
}

/** `menu:run-main`'s answer. */
export interface MainCommandRanView {
  readonly ran: true;
}

/** `sheet:get-head`: the session whose head a sheet follows. */
export interface SheetHeadRequest {
  readonly sessionId: string;
}

/** The answer of a request that opened something outside beuve. */
export interface OpenedView {
  readonly opened: true;
}

export interface OpenUrlRequest {
  readonly url: string;
}

/**
 * Whose turn a pull request is (ADR 0066): `you` (the signed-in user must act), `author`,
 * `reviewers`, or `unknown`. `reasons` are short sentences, most decisive first.
 */
export interface AttentionView {
  readonly turn: 'you' | 'author' | 'reviewers' | 'unknown';
  readonly reasons: readonly string[];
}

/** Whose turn: the attention set's `turn` (ADR 0066). */
export type TurnView = AttentionView['turn'];

/** What a review queue item is (ADR 0113): a pull request, or a branch without one. */
export type QueueItemKindView = 'pull-request' | 'branch';

/** Why an item is in the review queue: a review request, the viewer's own, an agent branch. */
export type QueueReasonView = 'requested' | 'authored' | 'branch';

/**
 * How far beuve's own review of an item got (ADR 0113): `none` never opened, `opened` without
 * marks or checkpoint, `partial` files marked, `reviewed` checkpoint on the current head,
 * `new-commits` a checkpoint and commits since.
 */
export type LocalReviewStateView = 'none' | 'opened' | 'partial' | 'reviewed' | 'new-commits';

/** The local review of a queue item, from the matching session. */
export interface QueueLocalReviewView {
  readonly state: LocalReviewStateView;
  readonly sessionId?: string;
  /** Files marked reviewed on the session's head. */
  readonly markedFiles?: number;
}

/**
 * A queue item's place in a stack of open pull requests within one repository (ADR 0113
 * amendment): the whole stack as GitHub has it, not only its queued members.
 */
export interface QueueStackView {
  /** The bottom pull request's key, shared by every item of the stack and stable across refreshes. */
  readonly id: string;
  /** 0 for the bottom pull request, 1 for the one based on it, … */
  readonly depth: number;
  /** Pull requests in the whole stack, queued or not. */
  readonly size: number;
  /** Its index in the stack's order: bottom first, each pull request before those based on it. */
  readonly position: number;
}

/**
 * What a queue item's `waitingSince` is (ADR 0113 amendment): when the viewer's review was last
 * requested, when changes were last requested of their own pull request, an agent branch's last
 * commit, or, failing those, the pull request's last activity (`updated_at`).
 */
export type QueueWaitingSourceView = 'requested' | 'changes-requested' | 'pushed' | 'updated';

/** Lines and files a change touches. */
export interface ChangeSizeView {
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
}

/** A queue item's CI on its head: the rollup, and how many checks fail. */
export interface QueueCiView {
  readonly overall: CiBucketView | 'none';
  readonly failing: number;
}

/**
 * One thing waiting on the viewer (ADR 0113). `key` is `host/owner/repo#n` or
 * `host/owner/repo:branch`, which is also what `github:open-pr` or `github:open-branch` takes as
 * `ref`. Timestamps are ISO-8601; `waitingSince` is when it started waiting, as
 * `waitingSinceSource` says. A context row (`isContext`) is a pull request of a queued item's
 * stack that is not itself waiting on the viewer: shown only within its stack, never counted.
 */
export interface ReviewQueueItemView {
  readonly key: string;
  readonly kind: QueueItemKindView;
  readonly forge: 'github';
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number?: number;
  /** The head branch: the branch itself, or a pull request's once its details were read. */
  readonly branch?: string;
  readonly baseBranch?: string;
  readonly title: string;
  readonly author: string;
  readonly isDraft: boolean;
  readonly htmlUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly waitingSince: string;
  readonly waitingSinceSource: QueueWaitingSourceView;
  readonly headSha?: string;
  readonly size?: ChangeSizeView;
  readonly ci?: QueueCiView;
  readonly attention: AttentionView;
  readonly reasons: readonly QueueReasonView[];
  /** For review requests: asked of the viewer by name, or only through a team. */
  readonly request?: 'direct' | 'team';
  readonly stack?: QueueStackView;
  readonly local: QueueLocalReviewView;
  /** The head commit's `Claude-Session` link, for branches (ADR 0112). */
  readonly agentSessionUrl?: string;
  /** Its source failed in the last refresh, so this is the last answer it gave. */
  readonly isStale?: boolean;
  /** Not waiting on the viewer: in the snapshot only as part of a queued item's stack. */
  readonly isContext?: boolean;
}

/**
 * Why the queue may be incomplete (ADR 0113): a source that failed (its items are the last ones it
 * gave, marked stale), results cut off, organizations GitHub left out for SAML SSO, or a token
 * that may not see team requests. `remedy` is a command or step that fixes it, when one does.
 */
export interface QueueProblemView {
  readonly kind: 'failed' | 'truncated' | 'sso' | 'scopes';
  /** What it is about: `github.com search`, `github.com/o/r branches`, `github.com/o/r#7`. */
  readonly source: string;
  readonly message: string;
  readonly remedy?: string;
}

/** The review queue as main last assembled it (`queue:get`, `queue:refresh`, `queue:updated`). */
export interface ReviewQueueView {
  readonly items: readonly ReviewQueueItemView[];
  readonly problems: readonly QueueProblemView[];
  /** When the last refresh finished; absent before the first. */
  readonly refreshedAt?: string;
  readonly isRefreshing: boolean;
}

/** How the review queue is ordered (ADR 0113). */
export type QueueSortView =
  'turn' | 'waiting' | 'oldest' | 'updated' | 'smallest' | 'largest' | 'stack' | 'new-since-review';

/** What the review queue is grouped by. */
export type QueueGroupView = 'none' | 'repository' | 'stack' | 'turn' | 'kind' | 'local';

/** CI states a queue filter can pick. */
export type QueueCiFilterView = 'failure' | 'pending' | 'success';

/** The review queue's filters; an empty list allows everything. */
export interface QueueFiltersView {
  readonly kinds: readonly QueueItemKindView[];
  /** `host/owner/repo`, lowercase. */
  readonly repositories: readonly string[];
  readonly authors: readonly string[];
  readonly request: 'any' | 'direct' | 'team';
  readonly hideDrafts: boolean;
  readonly ci: readonly QueueCiFilterView[];
  readonly turns: readonly TurnView[];
  readonly local: readonly LocalReviewStateView[];
  /** Show the viewer's own pull requests that are someone else's turn; off by default. */
  readonly showWaitingOnOthers: boolean;
}

/** The review queue's display preferences, kept in `settings.json`. */
export interface ReviewQueuePrefsView {
  readonly sort: QueueSortView;
  readonly group: QueueGroupView;
  readonly filters: QueueFiltersView;
}

/**
 * Pushed when polling finds a pull request changed (or its attention changed, as CI finishes);
 * `headMoved` when its head did. `attention` is absent until the reviews have been read.
 */
export interface PullRequestUpdatedView {
  readonly sessionId: string;
  readonly pullRequest: PullRequestView;
  readonly stack: PullRequestStackView;
  readonly headMoved: boolean;
  readonly attention?: AttentionView;
}

export interface CiStatusChangedView {
  readonly sessionId: string;
  readonly ci: CiStatusView;
}

/**
 * Expected failures of an invoke channel. `not-wired` means the backing service isn't composed
 * yet; `stale-review` that the head moved after the reviewer last saw it; `unsupported` that no
 * language server handles the file, or that a side of a file pair is binary or too large;
 * `lsp-failed` that the language server could not answer; `refused` that a valid request
 * contradicts the current state (approving over a blocker, an impossible status change).
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
  | 'refused'
  /**
   * The request was cancelled: superseded by a newer one of its kind, cancelled by id, or its
   * window closed (ADR 0079). The renderer drops it without a notice.
   */
  | 'cancelled'
  | 'internal';

export interface IpcError {
  readonly code: IpcErrorCode;
  readonly message: string;
}

/**
 * `menu:set-state` (ADR 0068): what the calling window reports about its focus and contents.
 * Main enables the menu items whose conditions hold and checks the toggles listed in `checked`.
 */
export interface MenuStateRequest {
  readonly conditions: readonly MenuCondition[];
  readonly checked: readonly CommandId[];
}

/** `menu:context`: pops up the context menu of `kind` at the pointer (or the focused element). */
export interface MenuContextRequest {
  readonly kind: ContextKind | 'text';
  readonly x?: number;
  readonly y?: number;
}

/** `menu:run-main`: runs a command main handles itself (Settings, About, …) from the palette. */
export interface MenuRunMainRequest {
  readonly id: CommandId;
}

/** `link:open-branch` (main to a main window): a confirmed `beuve://` link asks to follow this branch (ADR 0112). */
export interface OpenRemoteBranchLinkView {
  /** `host/owner/repo:branch`, as `github:open-branch` takes it. */
  readonly ref: string;
}

/** `link:open-pr` (main to a main window): a confirmed `beuve://` link asks to open this pull request (ADR 0098). */
export interface OpenPullRequestLinkView {
  /** `host/owner/repo#number`, as `github:open-pr` takes it. */
  readonly ref: string;
}

/** `menu:run` (main to the focused window): run the catalog command `id`. */
export interface MenuRunView {
  readonly id: CommandId;
}

/**
 * The Claude Code CLI beuve would run (ADR 0022), for the Settings window: where it was found and
 * the version it reports. Reading it never makes a model call.
 */
export type ClaudeStatusView =
  | {
      readonly kind: 'found';
      readonly command: string;
      readonly source: 'env' | 'known-location' | 'path' | 'configured';
      /** `claude --version`'s first line, when it answered in time. */
      readonly version?: string;
    }
  | { readonly kind: 'missing'; readonly message: string };

/** What a configured model is used for (ADR 0070); each role names one registry entry. */
export type ModelRole = 'chat' | 'review' | 'verify' | 'summarize' | 'compact';

/** The adapters a registry entry can configure (ADR 0069, 0070, 0071). */
export type ModelKind = 'claude-code-cli' | 'claude-agent-sdk' | 'openai-compatible';

/** How hard a model thinks: Claude Code's `--effort` levels. */
export type ModelEffortView = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Which Claude Code the Agent SDK runs: the user's installed `claude` (`path`, or found as the
 * chat finds it when omitted) or the binary packaged with beuve.
 */
export type ModelExecutableView =
  { readonly source: 'installed'; readonly path?: string } | { readonly source: 'bundled' };

/**
 * One model as the Settings window edits it. Main assigns `id` to a new entry. API keys are never
 * part of an entry: they are set and removed through their own write-only channels.
 */
export type ModelEntryInput = {
  readonly id?: string;
  readonly label: string;
  /** The default effort; `/review --effort` and the verification pass override it per request. */
  readonly effort?: ModelEffortView;
  /** Prompt budgets derive from it (ADR 0070). */
  readonly contextWindowTokens?: number;
} & (
  | { readonly kind: 'claude-code-cli'; readonly model?: string }
  | {
      readonly kind: 'claude-agent-sdk';
      readonly model?: string;
      readonly executable: ModelExecutableView;
    }
  | {
      readonly kind: 'openai-compatible';
      readonly model: string;
      /** The API root, e.g. `http://localhost:11434/v1`. */
      readonly baseUrl: string;
      /** Read-only file tools over the worktree (ADR 0071). */
      readonly tools: boolean;
    }
);

/** A stored entry, with what the Settings window shows about it. */
export type ModelEntryView = ModelEntryInput & {
  readonly id: string;
  /** Whether an API key is stored for it; the key itself never leaves main. */
  readonly hasApiKey: boolean;
  /** An OpenAI-compatible base URL that is not this machine: the diff leaves it (ADR 0071). */
  readonly isRemote: boolean;
  /** The built-in entry, which can be edited but not removed. */
  readonly isDefault: boolean;
};

/** `models:list` and every registry change: the entries, the roles and how keys are stored. */
export interface ModelRegistryView {
  readonly entries: readonly ModelEntryView[];
  readonly roles: Readonly<Record<ModelRole, string>>;
  /**
   * `os`: the system keychain or keyring encrypts keys; `basic`: Electron found no keyring and
   * uses a fixed key (Linux without libsecret); `unavailable`: keys can't be stored.
   */
  readonly keyStorage: 'os' | 'basic' | 'unavailable';
  /** Whether a Claude Code binary is packaged with this build for the Agent SDK. */
  readonly hasBundledClaudeCode: boolean;
}

export interface SaveModelRequest {
  readonly entry: ModelEntryInput;
}

export interface ModelIdRequest {
  readonly id: string;
}

export interface SetModelRoleRequest {
  readonly role: ModelRole;
  readonly id: string;
}

/** Write-only: the key goes to main's encrypted store and never comes back. */
export interface SetModelKeyRequest {
  readonly id: string;
  readonly apiKey: string;
}

/** `models:list-remote`: the models an OpenAI-compatible server offers, using `id`'s key if set. */
export interface ListRemoteModelsRequest {
  readonly baseUrl: string;
  readonly id?: string;
}

export interface RemoteModelsView {
  readonly models: readonly string[];
}

/** `models:test`: one tiny request through the chat's queue, like a question. */
export type ModelTestView =
  | {
      readonly outcome: 'ok';
      readonly elapsedMs: number;
      readonly model: string | undefined;
    }
  | {
      readonly outcome: 'failed';
      readonly elapsedMs: number;
      /** The model port's error kind (`not-authenticated`, `rate-limited`, `timeout`, …). */
      readonly errorKind: string;
      readonly message: string;
    };

/** Every invoke response is a `Result`, so expected failures never surface as rejected promises. */
export type IpcResult<T> = Result<T, IpcError>;

/** Request/response pairs for `ipcRenderer.invoke` channels. */
export interface InvokeChannelMap {
  'app:get-info': { readonly request: undefined; readonly response: IpcResult<AppInfo> };
  'session:list': {
    readonly request: undefined;
    readonly response: IpcResult<readonly SessionSummary[]>;
  };
  'session:create-local': {
    readonly request: CreateLocalSessionRequest;
    readonly response: IpcResult<SessionSummary>;
  };
  'repository:inspect': {
    readonly request: InspectRepositoryRequest;
    readonly response: IpcResult<RepositoryInspectionView>;
  };
  'dialog:choose-folder': {
    readonly request: ChooseFolderRequest;
    readonly response: IpcResult<ChooseFolderResponse>;
  };
  'session:get-review': {
    readonly request: GetReviewRequest;
    readonly response: IpcResult<ReviewView>;
  };
  'session:mark-reviewed': {
    readonly request: MarkReviewedRequest;
    readonly response: IpcResult<SessionSummary>;
  };
  'session:get-order': {
    readonly request: GetReviewOrderRequest;
    readonly response: IpcResult<ReviewOrderView>;
  };
  'review:set-file-reviewed': {
    readonly request: SetFileReviewedRequest;
    readonly response: IpcResult<SetFileReviewedResponse>;
  };
  'session:get-file-pair': {
    readonly request: GetFilePairRequest;
    readonly response: IpcResult<FilePairView>;
  };
  'session:get-tree': {
    readonly request: GetTreeRequest;
    readonly response: IpcResult<RepositoryTreeView>;
  };
  'session:get-file-attributes': {
    readonly request: GetFileAttributesRequest;
    readonly response: IpcResult<FileAttributesView>;
  };
  'lsp:call-hierarchy': {
    readonly request: CallHierarchyRequest;
    readonly response: IpcResult<CallHierarchyView>;
  };
  'lsp:definition': {
    readonly request: DefinitionRequest;
    readonly response: IpcResult<DefinitionView>;
  };
  'lsp:hover': {
    readonly request: HoverRequest;
    readonly response: IpcResult<HoverView>;
  };
  'lsp:diagnostics': {
    readonly request: DiagnosticsRequest;
    readonly response: IpcResult<DiagnosticsView>;
  };
  'sheet:open': {
    readonly request: OpenSheetRequest;
    readonly response: IpcResult<OpenedView>;
  };
  'sheet:get-file': {
    readonly request: SheetFileRequest;
    readonly response: IpcResult<SheetFileView>;
  };
  'sheet:get-head': {
    readonly request: SheetHeadRequest;
    readonly response: IpcResult<SheetHeadView>;
  };
  'remote:permalink': {
    readonly request: PermalinkRequest;
    readonly response: IpcResult<PermalinkView>;
  };
  'remote:open-permalink': {
    readonly request: PermalinkRequest;
    readonly response: IpcResult<PermalinkView>;
  };
  'remote:open-commit': {
    readonly request: CommitLinkRequest;
    readonly response: IpcResult<PermalinkView>;
  };
  'session:get-commit': {
    readonly request: GetCommitRequest;
    readonly response: IpcResult<CommitInfoView>;
  };
  'flow:get-graph': {
    readonly request: GetFlowGraphRequest;
    readonly response: IpcResult<FlowGraphResponse>;
  };
  'lsp:restart': {
    readonly request: LspRestartRequest;
    readonly response: IpcResult<LspRestartedView>;
  };
  'lsp:status': { readonly request: undefined; readonly response: IpcResult<LspStatusView> };
  'terminal:open': {
    readonly request: TerminalOpenRequest;
    readonly response: IpcResult<TerminalView>;
  };
  'terminal:list': {
    readonly request: TerminalListRequest;
    readonly response: IpcResult<TerminalListView>;
  };
  'terminal:write': {
    readonly request: TerminalWriteRequest;
    readonly response: IpcResult<TerminalAckView>;
  };
  'terminal:resize': {
    readonly request: TerminalResizeRequest;
    readonly response: IpcResult<TerminalAckView>;
  };
  'terminal:close': {
    readonly request: TerminalCloseRequest;
    readonly response: IpcResult<TerminalAckView>;
  };
  'ura:list': { readonly request: ListUraItemsRequest; readonly response: IpcResult<UraListView> };
  'ura:create': {
    readonly request: CreateUraItemRequest;
    readonly response: IpcResult<UraItemView>;
  };
  'ura:update': {
    readonly request: UpdateUraItemRequest;
    readonly response: IpcResult<UraItemView>;
  };
  'ura:transition': {
    readonly request: TransitionUraItemRequest;
    readonly response: IpcResult<UraItemView>;
  };
  'ura:reorder': {
    readonly request: ReorderUraItemsRequest;
    readonly response: IpcResult<UraOrderView>;
  };
  'ura:stage-review-finding': {
    readonly request: StageReviewFindingRequest;
    readonly response: IpcResult<UraStagedView>;
  };
  'ura:set-verdict': {
    readonly request: SetUraVerdictRequest;
    readonly response: IpcResult<UraVerdictStateView>;
  };
  'ura:export': {
    readonly request: ExportUraRequest;
    readonly response: IpcResult<UraExportView>;
  };
  'chat:ask': { readonly request: ChatAskRequest; readonly response: IpcResult<ChatAskedView> };
  'chat:list': { readonly request: ChatListRequest; readonly response: IpcResult<ChatListView> };
  'chat:cancel': {
    readonly request: ChatCancelRequest;
    readonly response: IpcResult<ChatCancelledView>;
  };
  'request:cancel': {
    readonly request: CancelRequestRequest;
    readonly response: IpcResult<RequestCancelledView>;
  };
  'chat:compact': {
    readonly request: ChatCompactRequest;
    readonly response: IpcResult<ChatCompactedView>;
  };
  'chat:clear': {
    readonly request: ChatClearRequest;
    readonly response: IpcResult<ChatClearedView>;
  };
  'clipboard:write-text': {
    readonly request: WriteClipboardRequest;
    readonly response: IpcResult<ClipboardWrittenView>;
  };
  'editor:open': {
    readonly request: EditorOpenRequest;
    readonly response: IpcResult<EditorOpenResponse>;
  };
  'editor:get-settings': {
    readonly request: undefined;
    readonly response: IpcResult<EditorSettingsView>;
  };
  'editor:set-preferred': {
    readonly request: SetPreferredEditorRequest;
    readonly response: IpcResult<EditorSettingsView>;
  };
  'editor:set-review-edits-prefix': {
    readonly request: SetReviewEditsPrefixRequest;
    readonly response: IpcResult<EditorSettingsView>;
  };
  'review-edits:get': {
    readonly request: ReviewEditsRequest;
    readonly response: IpcResult<ReviewEditsView>;
  };
  'review-edits:open': {
    readonly request: OpenReviewEditsRequest;
    readonly response: IpcResult<ReviewEditsOpenedView>;
  };
  'review-edits:preview-suggestions': {
    readonly request: ReviewEditsRequest;
    readonly response: IpcResult<ReviewEditsPlanView>;
  };
  'review-edits:stage-suggestions': {
    readonly request: StageReviewEditsRequest;
    readonly response: IpcResult<ReviewEditsStagedView>;
  };
  'review-edits:preview-discard': {
    readonly request: ReviewEditsRequest;
    readonly response: IpcResult<ReviewEditsDiscardView>;
  };
  'review-edits:discard': {
    readonly request: DiscardReviewEditsRequest;
    readonly response: IpcResult<ReviewEditsDiscardedView>;
  };
  'display:get': {
    readonly request: undefined;
    readonly response: IpcResult<DiffDisplayView>;
  };
  'display:set': {
    readonly request: SetDiffDisplayRequest;
    readonly response: IpcResult<DiffDisplayView>;
  };
  /** The review queue (ADR 0113); refreshes first when it is stale. */
  'queue:get': {
    readonly request: undefined;
    readonly response: IpcResult<ReviewQueueView>;
  };
  /** Refreshes the review queue now, unless search was asked moments ago. */
  'queue:refresh': {
    readonly request: undefined;
    readonly response: IpcResult<ReviewQueueView>;
  };
  'github:auth-status': {
    readonly request: GithubAuthStatusRequest;
    readonly response: IpcResult<GithubAuthStatusView>;
  };
  'github:open-pr': {
    readonly request: OpenPullRequestRequest;
    readonly response: IpcResult<OpenPullRequestResponse>;
  };
  'github:get-pr': {
    readonly request: GetReviewRequest;
    readonly response: IpcResult<PullRequestSessionView>;
  };
  'github:open-branch': {
    readonly request: OpenRemoteBranchRequest;
    readonly response: IpcResult<OpenRemoteBranchResponse>;
  };
  'github:get-branch': {
    readonly request: GetReviewRequest;
    readonly response: IpcResult<RemoteBranchSessionView>;
  };
  'github:get-timeline': {
    readonly request: GetTimelineRequest;
    readonly response: IpcResult<PullRequestTimelineView | GithubFailureView>;
  };
  'github:preview-review': {
    readonly request: PostGithubReviewRequest;
    readonly response: IpcResult<GithubReviewPreviewView | GithubFailureView>;
  };
  'github:post-review': {
    readonly request: PostGithubReviewRequest;
    readonly response: IpcResult<PostGithubReviewResponse>;
  };
  'github:open-link': {
    readonly request: OpenGithubLinkRequest;
    readonly response: IpcResult<OpenedView>;
  };
  'shell:open-url': {
    readonly request: OpenUrlRequest;
    readonly response: IpcResult<OpenedView>;
  };
  'menu:set-state': {
    readonly request: MenuStateRequest;
    readonly response: IpcResult<MenuStateAppliedView>;
  };
  'menu:context': {
    readonly request: MenuContextRequest;
    readonly response: IpcResult<ContextMenuShownView>;
  };
  'menu:run-main': {
    readonly request: MenuRunMainRequest;
    readonly response: IpcResult<MainCommandRanView>;
  };
  'claude:status': {
    readonly request: undefined;
    readonly response: IpcResult<ClaudeStatusView>;
  };
  'models:list': { readonly request: undefined; readonly response: IpcResult<ModelRegistryView> };
  'models:save': {
    readonly request: SaveModelRequest;
    readonly response: IpcResult<ModelRegistryView>;
  };
  'models:remove': {
    readonly request: ModelIdRequest;
    readonly response: IpcResult<ModelRegistryView>;
  };
  'models:set-role': {
    readonly request: SetModelRoleRequest;
    readonly response: IpcResult<ModelRegistryView>;
  };
  'models:set-key': {
    readonly request: SetModelKeyRequest;
    readonly response: IpcResult<ModelRegistryView>;
  };
  'models:remove-key': {
    readonly request: ModelIdRequest;
    readonly response: IpcResult<ModelRegistryView>;
  };
  'models:list-remote': {
    readonly request: ListRemoteModelsRequest;
    readonly response: IpcResult<RemoteModelsView>;
  };
  'models:test': { readonly request: ModelIdRequest; readonly response: IpcResult<ModelTestView> };
  'language-servers:open-config': {
    readonly request: undefined;
    readonly response: IpcResult<OpenedConfigView>;
  };
}

export type InvokeChannel = keyof InvokeChannelMap;
export type InvokeRequest<C extends InvokeChannel> = InvokeChannelMap[C]['request'];
export type InvokeResponse<C extends InvokeChannel> = InvokeChannelMap[C]['response'];

/** Payloads main pushes to the renderer with `webContents.send`. */
export interface EventChannelMap {
  'chat:stream': ChatStreamEvent;
  'ura:changed': UraChangedView;
  'github:pr-updated': PullRequestUpdatedView;
  'github:ci-status': CiStatusChangedView;
  /** A followed branch changed, went away, came back or got a pull request (ADR 0112). */
  'github:branch-updated': RemoteBranchUpdatedView;
  /** The review queue changed, or started or finished refreshing (ADR 0113). */
  'queue:updated': ReviewQueueView;
  /** A terminal wrote output (ADR 0095). */
  'terminal:data': TerminalDataEvent;
  /** A terminal's shell ended. */
  'terminal:exit': TerminalExitEvent;
  /** Run a menu, shortcut or context menu command in this window (ADR 0068). */
  'menu:run': MenuRunView;
  /** Open a pull request a `beuve://` link asked for and the reviewer confirmed (ADR 0098). */
  'link:open-pr': OpenPullRequestLinkView;
  /** Follow a branch a `beuve://` link asked for and the reviewer confirmed (ADR 0112). */
  'link:open-branch': OpenRemoteBranchLinkView;
  /** Preferences changed in another window (the Settings window); read them again. */
  'settings:changed': Readonly<Record<string, never>>;
}

export type EventChannel = keyof EventChannelMap;
export type EventPayload<E extends EventChannel> = EventChannelMap[E];

/** Unsubscribes a listener registered with {@link BeuveApi.on}. */
export type Unsubscribe = () => void;

/** The channels a sheet window may call (ADR 0067); its preload and main allow nothing else. */
export type SheetInvokeChannel =
  | 'lsp:definition'
  | 'lsp:hover'
  | 'lsp:diagnostics'
  | 'display:get'
  | 'sheet:open'
  | 'sheet:get-file'
  | 'sheet:get-head'
  | 'remote:permalink'
  | 'remote:open-permalink'
  | 'clipboard:write-text'
  | 'menu:set-state'
  | 'menu:context';

/** The API the sheet preload exposes as `window.beuve`: sheet channels, and `menu:run` only. */
export interface SheetApi {
  readonly invoke: <C extends SheetInvokeChannel>(
    channel: C,
    ...request: InvokeRequest<C> extends undefined ? [] : [InvokeRequest<C>]
  ) => Promise<InvokeResponse<C>>;
  /** In a sheet window only: the menu's commands for this window (ADR 0068). */
  readonly onMenuRun?: (listener: (payload: MenuRunView) => void) => Unsubscribe;
}

/** The channels the Settings window may call (ADR 0068); its preload and main allow nothing else. */
export type SettingsInvokeChannel =
  | 'display:get'
  | 'display:set'
  | 'editor:get-settings'
  | 'editor:set-preferred'
  | 'editor:set-review-edits-prefix'
  | 'github:auth-status'
  | 'claude:status'
  | 'menu:set-state'
  | SettingsOnlyInvokeChannel;

/**
 * The model registry's channels (ADR 0070): only the Settings window may call them, never the
 * main window or a sheet, so a compromised review page can't swap the model or test a key.
 */
export type SettingsOnlyInvokeChannel =
  | 'language-servers:open-config'
  | 'models:list'
  | 'models:save'
  | 'models:remove'
  | 'models:set-role'
  | 'models:set-key'
  | 'models:remove-key'
  | 'models:list-remote'
  | 'models:test';

/** The API the Settings preload exposes as `window.beuve`: invoke only, settings channels only. */
export interface SettingsApi {
  readonly invoke: <C extends SettingsInvokeChannel>(
    channel: C,
    ...request: InvokeRequest<C> extends undefined ? [] : [InvokeRequest<C>]
  ) => Promise<InvokeResponse<C>>;
}

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
