import type {
  ClaudeStatusView,
  CreateLocalSessionRequest,
  GetReviewRequest,
  InspectRepositoryRequest,
  IpcResult,
  MarkReviewedRequest,
  RepositoryInspectionView,
  ReviewView,
  SessionSummary,
  SetFileReviewedRequest,
  SetFileReviewedResponse,
} from '#contract/ipc-contract.ts';
import type { RequestOptions } from './request-options.ts';

import type { ChatServices } from './chat/create-chat-services.ts';
import type { DisplayServices } from './display/create-display-services.ts';
import type { EditorServices } from './editor/create-editor-services.ts';
import type { ReviewEditsServices } from './review-edits/create-review-edits-services.ts';
import type { FileServices } from './files/create-file-services.ts';
import type { FlowServices } from './flow/create-flow-services.ts';
import type { GithubServices } from './github/create-github-services.ts';
import type { LspServices } from './lsp/create-lsp-services.ts';
import type { OrderServices } from './order/create-order-services.ts';
import type { ReviewQueueServices } from './queue/create-review-queue-services.ts';
import type { LanguageServerConfigServices } from './language-servers/create-language-server-config-services.ts';
import type { ModelServices } from './models/create-model-services.ts';
import type { RemoteServices } from './remote/create-remote-services.ts';
import type { ShellServices } from './shell/create-shell-services.ts';
import type { SheetServices } from './sheets/create-sheet-services.ts';
import type { TerminalServices } from './terminal/create-terminal-services.ts';
import type { UraServices } from './ura/create-ura-services.ts';

/** Session operations the renderer can reach. Adapters in `src/main` map domain types to the contract. */
export interface SessionServices {
  readonly list: () => IpcResult<readonly SessionSummary[]>;
  readonly createLocal: (request: CreateLocalSessionRequest) => Promise<IpcResult<SessionSummary>>;
  readonly getReview: (
    request: GetReviewRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<ReviewView>>;
  readonly markReviewed: (request: MarkReviewedRequest) => Promise<IpcResult<SessionSummary>>;
  readonly setFileReviewed: (
    request: SetFileReviewedRequest,
  ) => Promise<IpcResult<SetFileReviewedResponse>>;
  /** The repository containing a folder and its branches, before a session exists. */
  readonly inspectRepository: (
    request: InspectRepositoryRequest,
  ) => Promise<IpcResult<RepositoryInspectionView>>;
}

/**
 * Everything the IPC handlers delegate to: the seam where `src/main` composes the database and
 * domains. Inputs reaching these are already validated for shape.
 */
export interface MainServices {
  readonly sessions: SessionServices;
  readonly files: FileServices;
  readonly order: OrderServices;
  readonly lsp: Pick<
    LspServices,
    'callHierarchy' | 'definition' | 'diagnostics' | 'hover' | 'restart' | 'status'
  >;
  /** Sheets: whole files pinned to a commit (ADR 0067). */
  readonly sheets: SheetServices;
  /** Permalinks to the primary remote (ADR 0067). */
  readonly remote: RemoteServices;
  /** The browser for chat answers' links (ADR 0040, amended). */
  readonly shell: ShellServices;
  readonly flow: FlowServices;
  readonly editor: Omit<EditorServices, 'launchFile'>;
  /** Review edits: a writable branch whose edits become suggestions (ADR 0088). */
  readonly reviewEdits: ReviewEditsServices;
  readonly display: DisplayServices;
  readonly chat: Omit<ChatServices, 'observeHead' | 'testModel'>;
  readonly ura: Omit<
    UraServices,
    'observeHead' | 'compileArtifact' | 'listPostings' | 'recordPostings'
  >;
  /** Shells in beuve's checkouts (ADR 0095). */
  readonly terminal: TerminalServices;
  readonly github: Omit<GithubServices, 'badgeFor' | 'branchBadgeFor' | 'intentFor' | 'watch'>;
  /** Everything waiting on the signed-in GitHub user (ADR 0113). */
  readonly queue: ReviewQueueServices;
  /** The Claude Code CLI the chat would run, for the Settings window (ADR 0068). */
  readonly claude: { readonly status: () => Promise<IpcResult<ClaudeStatusView>> };
  /** The model registry, its keys and Test, for the Settings window only (ADR 0070). */
  readonly models: ModelServices;
  /** Opens the language server configuration for editing, for the Settings window (ADR 0111). */
  readonly languageServerConfig: LanguageServerConfigServices;
  /** Removes session checkouts no stored session head needs (run once at startup). Never rejects. */
  readonly pruneWorktrees: () => Promise<void>;
  /**
   * Aborts chat requests (answers, reviews, summaries), stops polling GitHub and the language servers.
   * Call once, on quit.
   */
  readonly dispose: () => Promise<void>;
}
