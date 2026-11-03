import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err } from '#x/result/result.ts';
import { hasControlCharacters } from '#x/text/has-control-characters.ts';

import { commandCatalog } from '#contract/command-catalog.ts';
import type { CommandId } from '#contract/command-catalog.ts';
import { menuConditions } from '#contract/menu-conditions.ts';
import { normalizePathPrefix } from '#contract/normalize-path-prefix.ts';
import type {
  AppInfo,
  ChooseFolderRequest,
  ClipboardWrittenView,
  ContextMenuShownView,
  MainCommandRanView,
  MenuStateAppliedView,
  OpenedView,
  ClaudeStatusView,
  MenuContextRequest,
  MenuStateRequest,
  CallHierarchyRequest,
  CallHierarchyView,
  ChooseFolderResponse,
  DefinitionRequest,
  DefinitionView,
  HoverRequest,
  HoverView,
  OpenSheetRequest,
  PermalinkRequest,
  PermalinkView,
  SheetFileView,
  SheetHeadView,
  SheetRangeView,
  ChatAskedView,
  ChatCancelledView,
  ChatClearedView,
  ChatCompactedView,
  ChatListView,
  EditorOpenResponse,
  DiffDisplayView,
  FileAttributesView,
  EditorSettingsView,
  ReviewEditsDiscardedView,
  ReviewEditsDiscardView,
  ReviewEditsOpenedView,
  ReviewEditsPlanView,
  ReviewEditsStagedView,
  ReviewEditsView,
  FilePairView,
  FlowGraphResponse,
  GithubAuthStatusView,
  GithubFailureView,
  GithubReviewPreviewView,
  InvokeChannel,
  InvokeResponse,
  IpcError,
  IpcResult,
  OpenPullRequestResponse,
  PostGithubReviewResponse,
  PullRequestSessionView,
  ChatCommandRequest,
  RepositoryInspectionView,
  RepositoryTreeView,
  RequestCancelledView,
  ReviewOrderView,
  ReviewView,
  SessionSummary,
  SetFileReviewedResponse,
  LspRestartedView,
  LspStatusView,
  TerminalAckView,
  TerminalListView,
  TerminalView,
  UraExportView,
  UraItemView,
  UraListView,
  UraOrderView,
  UraStagedView,
  UraVerdictStateView,
  ModelRegistryView,
  ModelTestView,
  RemoteModelsView,
} from '#contract/ipc-contract.ts';
import { modelRoles } from '#contract/model-roles.ts';
import type { MainServices } from '../main-services.ts';
import type { RequestOptions } from '../request-options.ts';
import { modelEntryInputFrom } from '../models/model-entry-input-from.ts';
import { modelEntrySchema } from '../models/model-entry-schema.ts';

import { RequestScopes } from './request-scopes.ts';
import type { SupersededKind } from './request-scopes.ts';

/** What the handlers need from Electron itself; tests pass a stub. */
/** The platform hooks, and the scopes superseded loads run in. */
export interface IpcHandlerOptions extends IpcPlatform {
  /** One per app, shared with `request:cancel` and window teardown; a fresh one by default. */
  readonly scopes?: RequestScopes;
}

/** Which window asked, and the kind (and optional id) of the scope its request runs in. */
interface ScopedRequest {
  readonly sender: IpcSender | undefined;
  readonly kind: SupersededKind;
  readonly id?: string | undefined;
}

export interface IpcPlatform {
  /** Absent outside Electron, where `clipboard:write-text` answers `not-wired`. */
  readonly writeClipboard?: (text: string) => Promise<void>;
  /** The system folder picker; absent outside Electron, where `dialog:choose-folder` answers `not-wired`. */
  readonly chooseFolder?: (options: ChooseFolderRequest) => Promise<string | undefined>;
  /**
   * Opens a new sheet window (ADR 0067) for a request main has already checked; absent outside
   * Electron, where `sheet:open` answers `not-wired`.
   */
  readonly openSheet?: (request: OpenSheetRequest) => void;
  /** Menu state, context menus and main-run commands (ADR 0068); absent outside Electron. */
  readonly menus?: {
    readonly setState: (webContentsId: number, state: MenuStateRequest) => void;
    readonly popup: (webContentsId: number, request: MenuContextRequest) => boolean;
    readonly runMainCommand: (webContentsId: number, id: string) => boolean;
  };
}

/** Who called: the web contents of the page, as `registerIpcHandlers` saw it. */
export interface IpcSender {
  readonly webContentsId: number;
}

/** One handler per invoke channel. Each takes the raw, untrusted renderer argument. */
export type IpcHandlers = {
  readonly [C in InvokeChannel]: (
    request: unknown,
    sender?: IpcSender,
  ) => InvokeResponse<C> | Promise<InvokeResponse<C>>;
};

const noRequest = z.undefined();
const httpScheme = /^https?:\/\//u;
const modelId = z.string().min(1).max(80);
const modelIdRequest = z.strictObject({ id: modelId });
const saveModelRequest = z.strictObject({ entry: modelEntrySchema });
const modelRoleRequest = z.strictObject({ role: z.enum(modelRoles), id: modelId });
const modelKeyRequest = z.strictObject({
  id: modelId,
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !hasControlCharacters(value) && !value.includes(' ')),
});
const listRemoteModelsRequest = z.strictObject({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((value) => httpScheme.test(value)),
  id: modelId.optional(),
});
const sessionId = z.string().min(1).max(200);
const sessionRequest = z.strictObject({ sessionId });
const reviewRequest = z.strictObject({ sessionId, ignoreWhitespace: z.boolean().optional() });
const revision = z.string().trim().min(1).max(1024);
const localSessionRequest = z.strictObject({
  repoPath: z.string().min(1).max(4096),
  baseRef: revision,
  headRef: revision,
});
const windowsDrivePath = /^[A-Za-z]:[\\/]/u;
const inspectRepositoryRequest = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => {
      return value.startsWith('/') || windowsDrivePath.test(value);
    }, 'expected an absolute path'),
});
const chooseFolderRequest = z.strictObject({
  title: z.string().max(200).optional(),
  defaultPath: z.string().min(1).max(4096).optional(),
});
/** The head the reviewer was shown, which every per-head request carries (ADR 0078). */
const expectedHeadSha = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u);
const markReviewedRequest = z.strictObject({ sessionId, expectedHeadSha });

const fileReviewedRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  reviewed: z.boolean(),
  expectedHeadSha,
});

const filePairRequest = z.strictObject({ sessionId, path: z.string().min(1).max(4096) });

const callHierarchyRequest = z.strictObject({
  sessionId,
  expectedHeadSha,
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(10_000_000),
  character: z.number().int().min(0).max(10_000_000).optional(),
  direction: z.enum(['incoming', 'outgoing']),
  nodeId: z.string().min(1).max(200).optional(),
});

const fullSha = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u);
/** Repository-relative, `/`-separated, already normal: no `..`, `.` or empty segments, no NUL. */
const sheetPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    return normalizePathPrefix(value) === value;
  }, 'expected a repository-relative path');
const character = z.number().int().min(0).max(10_000_000);

const definitionRequest = z.strictObject({
  sessionId,
  sha: fullSha.optional(),
  path: sheetPath,
  line: z.number().int().min(1).max(10_000_000),
  character: character.optional(),
  kind: z.enum(['definition', 'type-definition']).optional(),
});

const hoverRequest = z.strictObject({
  sessionId,
  sha: fullSha.optional(),
  path: sheetPath,
  line: z.number().int().min(1).max(10_000_000),
  character,
});

const sheetRange = z
  .strictObject({
    startLine: z.number().int().min(1).max(10_000_000),
    startCharacter: character,
    endLine: z.number().int().min(1).max(10_000_000),
    endCharacter: character,
  })
  .refine((range) => {
    return range.endLine >= range.startLine;
  }, 'endLine comes before startLine');

const openSheetRequest = z.strictObject({
  sessionId,
  sha: fullSha,
  path: sheetPath,
  range: sheetRange.optional(),
});

const sheetFileRequest = z.strictObject({ sessionId, sha: fullSha, path: sheetPath });

const permalinkRequest = z
  .strictObject({
    sessionId,
    sha: fullSha,
    path: sheetPath,
    startLine: z.number().int().min(1).max(10_000_000).optional(),
    endLine: z.number().int().min(1).max(10_000_000).optional(),
  })
  .refine((request) => {
    return (
      request.endLine === undefined ||
      (request.startLine !== undefined && request.endLine >= request.startLine)
    );
  }, 'endLine needs a startLine before it');

const commitLinkRequest = z.strictObject({ sessionId, sha: fullSha });

const flowGraphRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(10_000_000),
});

const terminalId = z.string().min(1).max(100);
const terminalCells = z.number().int().min(1).max(1000);
const terminalOpenRequest = z.strictObject({
  sessionId,
  expectedHeadSha,
  cols: terminalCells,
  rows: terminalCells,
});
const terminalWriteRequest = z.strictObject({ terminalId, data: z.string().max(1_048_576) });
const terminalResizeRequest = z.strictObject({
  terminalId,
  cols: terminalCells,
  rows: terminalCells,
});
const terminalCloseRequest = z.strictObject({ terminalId });

const pathPrefix = z
  .string()
  .max(4096)
  .transform((raw, context) => {
    const normalized = normalizePathPrefix(raw);
    if (normalized === undefined) {
      context.addIssue({ code: 'custom', message: 'expected a repository-relative path prefix' });
      return z.NEVER;
    }
    return normalized;
  });

const chatCommand = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('review'),
    pathPrefixes: z.array(pathPrefix).max(64).optional(),
    fresh: z.boolean().optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    verify: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('summarize') }),
]);

const uuid = z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u);
const commitSha = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u);

const repositoryPath = z.string().min(1).max(4096);
const line = z.number().int().min(1).max(10_000_000);
const uraSeverity = z.enum(['blocker', 'issue', 'question', 'nit', 'praise']);
const uraVerdict = z.enum(['approve', 'request-changes', 'comment']);
const uraTitle = z.string().max(1000);
const uraBody = z.string().max(100_000);
const uraPatch = z.string().max(1_000_000);

const uraAnchor = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('lines'),
      path: repositoryPath,
      startLine: line,
      endLine: line,
    })
    .refine((anchor) => {
      return anchor.endLine >= anchor.startLine;
    }, 'endLine comes before startLine'),
  z.strictObject({ kind: z.literal('file'), path: repositoryPath }),
  z.strictObject({ kind: z.literal('change') }),
]);

const uraCreateRequest = z.strictObject({
  sessionId,
  headSha: commitSha.optional(),
  anchor: uraAnchor,
  severity: uraSeverity,
  title: uraTitle,
  body: uraBody,
  suggestedPatch: uraPatch.optional(),
  origin: z.strictObject({ kind: z.literal('chat-answer'), messageId: uuid }).optional(),
});

const uraUpdateRequest = z.strictObject({
  itemId: uuid,
  severity: uraSeverity.optional(),
  title: uraTitle.optional(),
  body: uraBody.optional(),
  suggestedPatch: uraPatch.optional(),
});

const uraTransitionRequest = z.strictObject({
  itemId: uuid,
  to: z.enum(['staged', 'withdrawn', 'addressed']),
});

const uraReorderRequest = z.strictObject({
  sessionId,
  itemIds: z.array(uuid).max(10_000),
});

const stageReviewFindingRequest = z.strictObject({
  messageId: uuid,
  finding: z.number().int().min(0).max(1000),
  severity: uraSeverity.optional(),
});

const uraExportRequest = z.strictObject({
  sessionId,
  target: z.enum(['agent-json', 'agent-xml', 'github']),
  verdict: uraVerdict.optional(),
});

const verdictChoiceRequest = z.strictObject({
  sessionId,
  verdict: uraVerdict.optional(),
  expectedHeadSha,
});

const maxMentionSpan = 5000;
const chatMention = z
  .strictObject({
    path: pathPrefix,
    side: z.enum(['head', 'base']),
    startLine: line.optional(),
    endLine: line.optional(),
    sha: commitSha,
  })
  .refine((mention) => {
    return (mention.startLine === undefined) === (mention.endLine === undefined);
  }, 'give both lines or neither')
  .refine(
    (mention) => {
      return (
        mention.startLine === undefined ||
        mention.endLine === undefined ||
        (mention.endLine >= mention.startLine &&
          mention.endLine - mention.startLine < maxMentionSpan)
      );
    },
    `expected startLine <= endLine, at most ${String(maxMentionSpan)} lines`,
  );

const chatAskRequest = z.strictObject({
  sessionId,
  question: z.string().trim().min(1).max(8000),
  focus: z.strictObject({ path: repositoryPath, line: line.optional() }).optional(),
  mentions: z.array(chatMention).max(8).optional(),
  command: chatCommand.optional(),
});

const chatClearRequest = z.strictObject({ sessionId, queuedOnly: z.boolean().optional() });

const chatCancelRequest = z.union([
  z.strictObject({ messageId: uuid }),
  z.strictObject({ sessionId }),
]);

const editorOpenRequest = z.strictObject({
  sessionId,
  path: pathPrefix,
  line,
  column: z.number().int().min(1).max(100_000).optional(),
});
const preferredEditorRequest = z.strictObject({ editorId: z.enum(['zed', 'vscode', 'cursor']) });
const reviewEditsPrefixRequest = z.strictObject({ prefix: z.string().min(1).max(100) });
const openReviewEditsRequest = z.strictObject({
  sessionId,
  path: pathPrefix.optional(),
  line: line.optional(),
});
const digestRequest = z.strictObject({ sessionId, digest: z.string().regex(/^[\da-f]{64}$/u) });
const reviewOrderMode = z.enum(['path', 'imports', 'calls']);
const reviewOrderRequest = z.strictObject({ sessionId, mode: reviewOrderMode.optional() });
const displayRequest = z.strictObject({
  layout: z.enum(['split', 'unified']).optional(),
  ignoreWhitespace: z.boolean().optional(),
  sidebarSide: z.enum(['left', 'right']).optional(),
  showGenerated: z.boolean().optional(),
  showInsights: z.boolean().optional(),
  reviewOrder: reviewOrderMode.optional(),
  skipReviewed: z.boolean().optional(),
  sheets: z.enum(['window', 'inline']).optional(),
});

const catalogIds: ReadonlySet<string> = new Set(commandCatalog.map((command) => command.id));
const commandId = z
  .string()
  .max(64)
  .refine((id) => {
    return catalogIds.has(id);
  }, 'expected a catalog command')
  .transform((id) => id as CommandId);
const menuStateRequest = z.strictObject({
  conditions: z.array(z.enum(menuConditions)).max(menuConditions.length),
  checked: z.array(commandId).max(commandCatalog.length),
});
const menuContextRequest = z.strictObject({
  kind: z.enum(['line', 'file', 'tree', 'note', 'answer', 'sheet', 'text']),
  x: z.number().min(0).max(100_000).optional(),
  y: z.number().min(0).max(100_000).optional(),
});
const menuRunMainRequest = z.strictObject({ id: commandId });

const clipboardRequest = z.strictObject({ text: z.string().max(16 * 1024 * 1024) });

const githubAuthRequest = z.strictObject({ host: z.string().min(1).max(253).optional() });
const requestId = z.string().min(1).max(200);
const openPullRequestRequest = z.strictObject({
  ref: z.string().trim().min(1).max(2048),
  repoPath: z.string().trim().min(1).max(4096).optional(),
  requestId: requestId.optional(),
});
const cancelRequestRequest = z.strictObject({ requestId });
const githubReviewRequest = z.strictObject({
  sessionId,
  verdict: uraVerdict.optional(),
  expectedHeadSha,
  summary: z.string().max(65_536).optional(),
});
const githubLinkRequest = z.strictObject({ url: z.string().min(1).max(8192) });
const openUrlRequest = z.strictObject({ url: z.string().min(1).max(8192) });

/**
 * Builds the invoke handlers. The renderer is untrusted, so each handler validates its argument
 * before anything reaches `services`, and answers bad input with an `invalid-request` error.
 * Loads a window only needs the latest of run in a {@link RequestScopes} scope (ADR 0079): a
 * newer one of the same kind from that window, a `request:cancel` naming it, or the window
 * closing aborts it, git included, and it answers `cancelled`.
 */
export function createIpcHandlers(
  services: MainServices,
  appInfo: AppInfo,
  options: IpcHandlerOptions = {},
): IpcHandlers {
  const { scopes = new RequestScopes(), ...platform } = options;
  /** Runs `work` in a scope of `kind` for the sender's window; without a sender, unscoped. */
  const scoped = async <T>(
    { sender, kind, id }: ScopedRequest,
    work: (options: RequestOptions) => Promise<IpcResult<T>>,
  ): Promise<IpcResult<T>> => {
    if (sender === undefined) {
      return work({});
    }
    using scope = scopes.begin(sender.webContentsId, kind, id);
    const result = await work({ signal: scope.signal });
    if (scope.signal.aborted) {
      return err({ code: 'cancelled', message: 'cancelled' });
    }
    return result;
  };

  return {
    'app:get-info': (request): IpcResult<AppInfo> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return ok(appInfo);
      }
      return invalid(parsed.error);
    },
    'session:list': (request): IpcResult<readonly SessionSummary[]> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return services.sessions.list();
      }
      return invalid(parsed.error);
    },
    'session:create-local': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = localSessionRequest.safeParse(request);
      if (parsed.success) {
        return services.sessions.createLocal(parsed.data);
      }
      return invalid(parsed.error);
    },
    'repository:inspect': async (request): Promise<IpcResult<RepositoryInspectionView>> => {
      const parsed = inspectRepositoryRequest.safeParse(request);
      if (parsed.success) {
        return services.sessions.inspectRepository(parsed.data);
      }
      return invalid(parsed.error);
    },
    'dialog:choose-folder': async (request): Promise<IpcResult<ChooseFolderResponse>> => {
      const parsed = chooseFolderRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (platform.chooseFolder === undefined) {
        return err({ code: 'not-wired', message: 'no folder picker outside Electron' });
      }
      const { title, defaultPath } = parsed.data;
      const chosen = await platform.chooseFolder({
        ...(title !== undefined && { title }),
        ...(defaultPath !== undefined && { defaultPath }),
      });
      if (chosen === undefined) {
        return ok({ kind: 'cancelled' });
      }
      return ok({ kind: 'chosen', path: chosen });
    },
    'session:get-review': async (request, sender): Promise<IpcResult<ReviewView>> => {
      const parsed = reviewRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, ignoreWhitespace } = parsed.data;
      return scoped({ sender, kind: 'review' }, async (options) => {
        return services.sessions.getReview(
          { sessionId: id, ...(ignoreWhitespace !== undefined && { ignoreWhitespace }) },
          options,
        );
      });
    },
    'session:mark-reviewed': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = markReviewedRequest.safeParse(request);
      if (parsed.success) {
        return services.sessions.markReviewed(parsed.data);
      }
      return invalid(parsed.error);
    },
    'review:set-file-reviewed': async (request): Promise<IpcResult<SetFileReviewedResponse>> => {
      const parsed = fileReviewedRequest.safeParse(request);
      if (parsed.success) {
        return services.sessions.setFileReviewed(parsed.data);
      }
      return invalid(parsed.error);
    },
    'session:get-order': async (request, sender): Promise<IpcResult<ReviewOrderView>> => {
      const parsed = reviewOrderRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, mode } = parsed.data;
      return scoped({ sender, kind: 'order' }, async (options) => {
        return services.order.getOrder(
          { sessionId: id, ...(mode !== undefined && { mode }) },
          options,
        );
      });
    },
    'session:get-file-pair': async (request): Promise<IpcResult<FilePairView>> => {
      const parsed = filePairRequest.safeParse(request);
      if (parsed.success) {
        return services.files.getFilePair(parsed.data);
      }
      return invalid(parsed.error);
    },
    'session:get-tree': async (request, sender): Promise<IpcResult<RepositoryTreeView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return scoped({ sender, kind: 'tree' }, async (options) => {
          return services.files.getTree(parsed.data, options);
        });
      }
      return invalid(parsed.error);
    },
    'session:get-file-attributes': async (
      request,
      sender,
    ): Promise<IpcResult<FileAttributesView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return scoped({ sender, kind: 'file-attributes' }, async (options) => {
          return services.files.getFileAttributes(parsed.data, options);
        });
      }
      return invalid(parsed.error);
    },
    'lsp:call-hierarchy': async (request): Promise<IpcResult<CallHierarchyView>> => {
      const parsed = callHierarchyRequest.safeParse(request);
      if (parsed.success) {
        return services.lsp.callHierarchy(withoutUndefined(parsed.data));
      }
      return invalid(parsed.error);
    },
    'lsp:definition': async (request): Promise<IpcResult<DefinitionView>> => {
      const parsed = definitionRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sha, character: column, kind, ...required } = parsed.data;
      const definition: DefinitionRequest = {
        ...required,
        ...(sha !== undefined && { sha }),
        ...(column !== undefined && { character: column }),
        ...(kind !== undefined && { kind }),
      };
      return services.lsp.definition(definition);
    },
    'lsp:hover': async (request): Promise<IpcResult<HoverView>> => {
      const parsed = hoverRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sha, ...required } = parsed.data;
      const hover: HoverRequest = { ...required, ...(sha !== undefined && { sha }) };
      return services.lsp.hover(hover);
    },
    'sheet:open': async (request): Promise<IpcResult<OpenedView>> => {
      const parsed = openSheetRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (platform.openSheet === undefined) {
        return err({ code: 'not-wired', message: 'no sheet windows outside Electron' });
      }
      const { range, ...required } = parsed.data;
      const sheet: OpenSheetRequest = {
        ...required,
        ...(range !== undefined && { range: range satisfies SheetRangeView }),
      };
      const checked = await services.sheets.checkOpen(sheet);
      if (checked.ok) {
        platform.openSheet(sheet);
      }
      return checked;
    },
    'sheet:get-file': async (request, sender): Promise<IpcResult<SheetFileView>> => {
      const parsed = sheetFileRequest.safeParse(request);
      if (parsed.success) {
        return scoped({ sender, kind: 'sheet-file' }, async (options) => {
          return services.sheets.getFile(parsed.data, options);
        });
      }
      return invalid(parsed.error);
    },
    'sheet:get-head': async (request, sender): Promise<IpcResult<SheetHeadView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return scoped({ sender, kind: 'sheet-head' }, async (options) => {
          return services.sheets.getHead(parsed.data, options);
        });
      }
      return invalid(parsed.error);
    },
    'remote:permalink': async (request): Promise<IpcResult<PermalinkView>> => {
      const parsed = permalinkRequest.safeParse(request);
      if (parsed.success) {
        return services.remote.permalink(permalinkRequestFrom(parsed.data));
      }
      return invalid(parsed.error);
    },
    'remote:open-permalink': async (request): Promise<IpcResult<PermalinkView>> => {
      const parsed = permalinkRequest.safeParse(request);
      if (parsed.success) {
        return services.remote.openPermalink(permalinkRequestFrom(parsed.data));
      }
      return invalid(parsed.error);
    },
    'remote:open-commit': async (request): Promise<IpcResult<PermalinkView>> => {
      const parsed = commitLinkRequest.safeParse(request);
      if (parsed.success) {
        return services.remote.openCommit(parsed.data);
      }
      return invalid(parsed.error);
    },
    'flow:get-graph': async (request): Promise<IpcResult<FlowGraphResponse>> => {
      const parsed = flowGraphRequest.safeParse(request);
      if (parsed.success) {
        return services.flow.getGraph(parsed.data);
      }
      return invalid(parsed.error);
    },
    'lsp:restart': async (request): Promise<IpcResult<LspRestartedView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.lsp.restart(parsed.data);
      }
      return invalid(parsed.error);
    },
    'lsp:status': (request): IpcResult<LspStatusView> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return services.lsp.status();
      }
      return invalid(parsed.error);
    },
    'terminal:open': async (request): Promise<IpcResult<TerminalView>> => {
      const parsed = terminalOpenRequest.safeParse(request);
      if (parsed.success) {
        return services.terminal.open(parsed.data);
      }
      return invalid(parsed.error);
    },
    'terminal:list': (request): IpcResult<TerminalListView> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.terminal.list(parsed.data);
      }
      return invalid(parsed.error);
    },
    'terminal:write': (request): IpcResult<TerminalAckView> => {
      const parsed = terminalWriteRequest.safeParse(request);
      if (parsed.success) {
        return services.terminal.write(parsed.data);
      }
      return invalid(parsed.error);
    },
    'terminal:resize': (request): IpcResult<TerminalAckView> => {
      const parsed = terminalResizeRequest.safeParse(request);
      if (parsed.success) {
        return services.terminal.resize(parsed.data);
      }
      return invalid(parsed.error);
    },
    'terminal:close': (request): IpcResult<TerminalAckView> => {
      const parsed = terminalCloseRequest.safeParse(request);
      if (parsed.success) {
        return services.terminal.close(parsed.data);
      }
      return invalid(parsed.error);
    },
    'ura:list': async (request): Promise<IpcResult<UraListView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.ura.list(parsed.data);
      }
      return invalid(parsed.error);
    },
    'ura:create': async (request): Promise<IpcResult<UraItemView>> => {
      const parsed = uraCreateRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { headSha, suggestedPatch, origin, ...required } = parsed.data;
      return services.ura.create({
        ...required,
        ...(headSha !== undefined && { headSha }),
        ...(origin !== undefined && { origin }),
        ...(suggestedPatch !== undefined && { suggestedPatch }),
      });
    },
    'ura:update': async (request): Promise<IpcResult<UraItemView>> => {
      const parsed = uraUpdateRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { itemId, severity, title, body, suggestedPatch } = parsed.data;
      return services.ura.update({
        itemId,
        ...(severity !== undefined && { severity }),
        ...(title !== undefined && { title }),
        ...(body !== undefined && { body }),
        ...(suggestedPatch !== undefined && { suggestedPatch }),
      });
    },
    'ura:transition': async (request): Promise<IpcResult<UraItemView>> => {
      const parsed = uraTransitionRequest.safeParse(request);
      if (parsed.success) {
        return services.ura.transition(parsed.data);
      }
      return invalid(parsed.error);
    },
    'ura:reorder': (request): IpcResult<UraOrderView> => {
      const parsed = uraReorderRequest.safeParse(request);
      if (parsed.success) {
        return services.ura.reorder(parsed.data);
      }
      return invalid(parsed.error);
    },
    'ura:stage-review-finding': async (request): Promise<IpcResult<UraStagedView>> => {
      const parsed = stageReviewFindingRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { severity, ...required } = parsed.data;
      return services.ura.stageReviewFinding({
        ...required,
        ...(severity !== undefined && { severity }),
      });
    },
    'ura:set-verdict': (request): IpcResult<UraVerdictStateView> => {
      const parsed = verdictChoiceRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, verdict, expectedHeadSha: head } = parsed.data;
      return services.ura.setVerdict({
        sessionId: id,
        expectedHeadSha: head,
        ...(verdict !== undefined && { verdict }),
      });
    },
    'ura:export': async (request): Promise<IpcResult<UraExportView>> => {
      const parsed = uraExportRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { verdict, ...required } = parsed.data;
      return services.ura.export({ ...required, ...(verdict !== undefined && { verdict }) });
    },
    'chat:ask': async (request): Promise<IpcResult<ChatAskedView>> => {
      const parsed = chatAskRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { focus, mentions, command, ...required } = parsed.data;
      return services.chat.ask({
        ...required,
        ...(command !== undefined && { command: chatCommandFrom(command) }),
        ...(focus !== undefined && {
          focus: { path: focus.path, ...(focus.line !== undefined && { line: focus.line }) },
        }),
        ...(mentions !== undefined &&
          mentions.length > 0 && {
            mentions: mentions.map(({ path, side, startLine, endLine, sha }) => {
              return {
                path,
                side,
                ...(startLine !== undefined && endLine !== undefined && { startLine, endLine }),
                sha,
              };
            }),
          }),
      });
    },
    'chat:list': (request): IpcResult<ChatListView> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.chat.list(parsed.data);
      }
      return invalid(parsed.error);
    },
    'chat:cancel': (request): IpcResult<ChatCancelledView> => {
      const parsed = chatCancelRequest.safeParse(request);
      if (parsed.success) {
        return services.chat.cancel(parsed.data);
      }
      return invalid(parsed.error);
    },
    'request:cancel': (request, sender): IpcResult<RequestCancelledView> => {
      const parsed = cancelRequestRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      return ok({
        cancelled:
          sender !== undefined && scopes.cancel(sender.webContentsId, parsed.data.requestId),
      });
    },
    'chat:compact': async (request): Promise<IpcResult<ChatCompactedView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.chat.compact(parsed.data);
      }
      return invalid(parsed.error);
    },
    'chat:clear': (request): IpcResult<ChatClearedView> => {
      const parsed = chatClearRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { queuedOnly, ...required } = parsed.data;
      return services.chat.clear({ ...required, ...(queuedOnly === true && { queuedOnly }) });
    },
    'editor:open': async (request): Promise<IpcResult<EditorOpenResponse>> => {
      const parsed = editorOpenRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { column, ...required } = parsed.data;
      return services.editor.open({ ...required, ...(column !== undefined && { column }) });
    },
    'editor:get-settings': async (request): Promise<IpcResult<EditorSettingsView>> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return services.editor.getSettings();
      }
      return invalid(parsed.error);
    },
    'editor:set-preferred': async (request): Promise<IpcResult<EditorSettingsView>> => {
      const parsed = preferredEditorRequest.safeParse(request);
      if (parsed.success) {
        return services.editor.setPreferred(parsed.data);
      }
      return invalid(parsed.error);
    },
    'editor:set-review-edits-prefix': async (request): Promise<IpcResult<EditorSettingsView>> => {
      const parsed = reviewEditsPrefixRequest.safeParse(request);
      if (parsed.success) {
        return services.editor.setReviewEditsPrefix(parsed.data);
      }
      return invalid(parsed.error);
    },
    'review-edits:get': async (request): Promise<IpcResult<ReviewEditsView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.reviewEdits.get(parsed.data);
      }
      return invalid(parsed.error);
    },
    'review-edits:open': async (request): Promise<IpcResult<ReviewEditsOpenedView>> => {
      const parsed = openReviewEditsRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { path, line: at, ...required } = parsed.data;
      return services.reviewEdits.open({
        ...required,
        ...(path !== undefined && { path }),
        ...(at !== undefined && { line: at }),
      });
    },
    'review-edits:preview-suggestions': async (
      request,
    ): Promise<IpcResult<ReviewEditsPlanView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.reviewEdits.previewSuggestions(parsed.data);
      }
      return invalid(parsed.error);
    },
    'review-edits:stage-suggestions': async (
      request,
    ): Promise<IpcResult<ReviewEditsStagedView>> => {
      const parsed = digestRequest.safeParse(request);
      if (parsed.success) {
        return services.reviewEdits.stageSuggestions(parsed.data);
      }
      return invalid(parsed.error);
    },
    'review-edits:preview-discard': async (request): Promise<IpcResult<ReviewEditsDiscardView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.reviewEdits.previewDiscard(parsed.data);
      }
      return invalid(parsed.error);
    },
    'review-edits:discard': async (request): Promise<IpcResult<ReviewEditsDiscardedView>> => {
      const parsed = digestRequest.safeParse(request);
      if (parsed.success) {
        return services.reviewEdits.discard(parsed.data);
      }
      return invalid(parsed.error);
    },
    'github:auth-status': async (request): Promise<IpcResult<GithubAuthStatusView>> => {
      const parsed = githubAuthRequest.safeParse(request ?? {});
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { host } = parsed.data;
      return services.github.authStatus({ ...(host !== undefined && { host }) });
    },
    'github:open-pr': async (request, sender): Promise<IpcResult<OpenPullRequestResponse>> => {
      const parsed = openPullRequestRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { ref, repoPath, requestId: id } = parsed.data;
      return scoped({ sender, kind: 'open-pull-request', id }, async (options) => {
        return services.github.openPullRequest(
          { ref, ...(repoPath !== undefined && { repoPath }) },
          options,
        );
      });
    },
    'display:get': async (request): Promise<IpcResult<DiffDisplayView>> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return services.display.get();
      }
      return invalid(parsed.error);
    },
    'display:set': async (request): Promise<IpcResult<DiffDisplayView>> => {
      const parsed = displayRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const {
        layout,
        ignoreWhitespace,
        sidebarSide,
        showGenerated,
        showInsights,
        reviewOrder,
        skipReviewed,
        sheets,
      } = parsed.data;
      return services.display.set({
        ...(layout !== undefined && { layout }),
        ...(ignoreWhitespace !== undefined && { ignoreWhitespace }),
        ...(sidebarSide !== undefined && { sidebarSide }),
        ...(showGenerated !== undefined && { showGenerated }),
        ...(showInsights !== undefined && { showInsights }),
        ...(reviewOrder !== undefined && { reviewOrder }),
        ...(skipReviewed !== undefined && { skipReviewed }),
        ...(sheets !== undefined && { sheets }),
      });
    },
    'github:get-pr': async (request): Promise<IpcResult<PullRequestSessionView>> => {
      const parsed = sessionRequest.safeParse(request);
      if (parsed.success) {
        return services.github.getPullRequest(parsed.data.sessionId);
      }
      return invalid(parsed.error);
    },
    'github:preview-review': async (
      request,
    ): Promise<IpcResult<GithubReviewPreviewView | GithubFailureView>> => {
      const parsed = githubReviewRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, verdict, expectedHeadSha: head } = parsed.data;
      return services.github.previewReview({
        sessionId: id,
        expectedHeadSha: head,
        ...(verdict !== undefined && { verdict }),
      });
    },
    'github:post-review': async (request): Promise<IpcResult<PostGithubReviewResponse>> => {
      const parsed = githubReviewRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, verdict, expectedHeadSha: head, summary } = parsed.data;
      return services.github.postReview({
        sessionId: id,
        expectedHeadSha: head,
        ...(verdict !== undefined && { verdict }),
        ...(summary !== undefined && { summary }),
      });
    },
    'github:open-link': async (request): Promise<IpcResult<OpenedView>> => {
      const parsed = githubLinkRequest.safeParse(request);
      if (parsed.success) {
        return services.github.openLink(parsed.data);
      }
      return invalid(parsed.error);
    },
    'shell:open-url': async (request): Promise<IpcResult<OpenedView>> => {
      const parsed = openUrlRequest.safeParse(request);
      if (parsed.success) {
        return services.shell.openUrl(parsed.data);
      }
      return invalid(parsed.error);
    },
    'menu:set-state': (request, sender): IpcResult<MenuStateAppliedView> => {
      const parsed = menuStateRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (sender === undefined || platform.menus === undefined) {
        return err({ code: 'not-wired', message: 'no menus outside Electron' });
      }
      platform.menus.setState(sender.webContentsId, parsed.data);
      return ok({ applied: true });
    },
    'menu:context': (request, sender): IpcResult<ContextMenuShownView> => {
      const parsed = menuContextRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (sender === undefined || platform.menus === undefined) {
        return err({ code: 'not-wired', message: 'no menus outside Electron' });
      }
      const { kind, x, y } = parsed.data;
      return ok({
        shown: platform.menus.popup(sender.webContentsId, {
          kind,
          ...(x !== undefined && { x }),
          ...(y !== undefined && { y }),
        }),
      });
    },
    'menu:run-main': (request, sender): IpcResult<MainCommandRanView> => {
      const parsed = menuRunMainRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (sender === undefined || platform.menus === undefined) {
        return err({ code: 'not-wired', message: 'no menus outside Electron' });
      }
      if (platform.menus.runMainCommand(sender.webContentsId, parsed.data.id)) {
        return ok({ ran: true });
      }
      return err({ code: 'refused', message: `${parsed.data.id} is not a main-process command` });
    },
    'claude:status': async (request): Promise<IpcResult<ClaudeStatusView>> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return services.claude.status();
      }
      return invalid(parsed.error);
    },
    'models:list': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = noRequest.safeParse(request);
      if (parsed.success) {
        return services.models.list();
      }
      return invalid(parsed.error);
    },
    'models:save': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = saveModelRequest.safeParse(request);
      if (parsed.success) {
        return services.models.save(modelEntryInputFrom(parsed.data.entry));
      }
      return invalid(parsed.error);
    },
    'models:remove': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelIdRequest.safeParse(request);
      if (parsed.success) {
        return services.models.remove(parsed.data.id);
      }
      return invalid(parsed.error);
    },
    'models:set-role': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelRoleRequest.safeParse(request);
      if (parsed.success) {
        return services.models.setRole(parsed.data.role, parsed.data.id);
      }
      return invalid(parsed.error);
    },
    'models:set-key': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelKeyRequest.safeParse(request);
      // Never echo the request: a validation message could quote the key.
      if (parsed.success) {
        return services.models.setKey({ id: parsed.data.id, apiKey: parsed.data.apiKey });
      }
      return err({
        code: 'invalid-request',
        message: 'expected { id, apiKey } with a key of 1 to 4096 printable characters',
      });
    },
    'models:remove-key': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelIdRequest.safeParse(request);
      if (parsed.success) {
        return services.models.removeKey(parsed.data.id);
      }
      return invalid(parsed.error);
    },
    'models:list-remote': async (request): Promise<IpcResult<RemoteModelsView>> => {
      const parsed = listRemoteModelsRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { baseUrl, id } = parsed.data;
      return services.models.listRemote({ baseUrl, ...(id !== undefined && { id }) });
    },
    'models:test': async (request): Promise<IpcResult<ModelTestView>> => {
      const parsed = modelIdRequest.safeParse(request);
      if (parsed.success) {
        return services.models.test(parsed.data.id);
      }
      return invalid(parsed.error);
    },
    'clipboard:write-text': async (request): Promise<IpcResult<ClipboardWrittenView>> => {
      const parsed = clipboardRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (platform.writeClipboard === undefined) {
        return err({ code: 'not-wired', message: 'no clipboard outside Electron' });
      }
      await platform.writeClipboard(parsed.data.text);
      return ok({ length: parsed.data.text.length });
    },
  };
}

function permalinkRequestFrom(request: z.infer<typeof permalinkRequest>): PermalinkRequest {
  const { startLine, endLine, ...required } = request;
  return {
    ...required,
    ...(startLine !== undefined && { startLine }),
    ...(endLine !== undefined && { endLine }),
  };
}

function withoutUndefined(request: z.infer<typeof callHierarchyRequest>): CallHierarchyRequest {
  const { character, nodeId, ...required } = request;
  return {
    ...required,
    ...(character !== undefined && { character }),
    ...(nodeId !== undefined && { nodeId }),
  };
}

function chatCommandFrom(command: z.infer<typeof chatCommand>): ChatCommandRequest {
  if (command.kind === 'summarize') {
    return command;
  }
  const { pathPrefixes, fresh, effort, verify } = command;
  const prefixes = [...new Set(pathPrefixes)];
  return {
    kind: 'review',
    ...(prefixes.length > 0 && { pathPrefixes: prefixes }),
    ...(fresh === true && { fresh }),
    ...(effort !== undefined && { effort }),
    ...(verify !== undefined && { verify }),
  };
}

function invalid(error: z.ZodError): Err<IpcError> {
  return err({ code: 'invalid-request', message: z.prettifyError(error) });
}
