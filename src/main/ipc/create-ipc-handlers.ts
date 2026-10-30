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
  ClaudeStatusView,
  MenuContextRequest,
  MenuStateRequest,
  TraceTrustEntryView,
  CallHierarchyRequest,
  CallHierarchyView,
  ChooseFolderResponse,
  DefinitionRequest,
  DefinitionView,
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
  FilePairView,
  FlowGraphResponse,
  GithubAuthStatusView,
  GithubFailureView,
  GithubReviewPreviewView,
  ImpactView,
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
  ReviewOrderView,
  ReviewView,
  SessionSummary,
  SetFileReviewedResponse,
  TraceCancelledView,
  TraceRunStartedView,
  TraceTrustView,
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
import { modelEntryInputFrom } from '../models/model-entry-input-from.ts';
import { modelEntrySchema } from '../models/model-entry-schema.ts';

/** What the handlers need from Electron itself; tests pass a stub. */
export interface IpcPlatform {
  /** Absent outside Electron, where `clipboard:write-text` answers `not-wired`. */
  readonly writeClipboard?: (text: string) => Promise<void>;
  /** The system folder picker; absent outside Electron, where `dialog:choose-folder` answers `not-wired`. */
  readonly chooseFolder?: (options: {
    readonly title?: string;
    readonly defaultPath?: string;
  }) => Promise<string | undefined>;
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
    .refine(
      (value) => value.startsWith('/') || windowsDrivePath.test(value),
      'expected an absolute path',
    ),
});
const chooseFolderRequest = z.strictObject({
  title: z.string().max(200).optional(),
  defaultPath: z.string().min(1).max(4096).optional(),
});
const markReviewedRequest = z.strictObject({
  sessionId,
  expectedHeadSha: z
    .string()
    .regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u)
    .optional(),
});

const fileReviewedRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  reviewed: z.boolean(),
  expectedHeadSha: z
    .string()
    .regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u)
    .optional(),
});

const filePairRequest = z.strictObject({ sessionId, path: z.string().min(1).max(4096) });

const callHierarchyRequest = z.strictObject({
  sessionId,
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
  .refine((value) => normalizePathPrefix(value) === value, 'expected a repository-relative path');
const character = z.number().int().min(0).max(10_000_000);

const definitionRequest = z.strictObject({
  sessionId,
  sha: fullSha.optional(),
  path: sheetPath,
  line: z.number().int().min(1).max(10_000_000),
  character: character.optional(),
  kind: z.enum(['definition', 'type-definition']).optional(),
});

const sheetRange = z
  .strictObject({
    startLine: z.number().int().min(1).max(10_000_000),
    startCharacter: character,
    endLine: z.number().int().min(1).max(10_000_000),
    endCharacter: character,
  })
  .refine((range) => range.endLine >= range.startLine, 'endLine comes before startLine');

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
  .refine(
    (request) =>
      request.endLine === undefined ||
      (request.startLine !== undefined && request.endLine >= request.startLine),
    'endLine needs a startLine before it',
  );

const flowGraphRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(10_000_000),
});

const traceRunRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(10_000_000),
  testNamePattern: z.string().min(1).max(1000).optional(),
});

const traceTrustRequest = z.strictObject({ sessionId, trusted: z.boolean() });

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
    .refine((anchor) => anchor.endLine >= anchor.startLine, 'endLine comes before startLine'),
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

const stageFindingRequest = z.strictObject({
  sessionId,
  path: repositoryPath,
  functionName: z.string().min(1).max(1000),
});

const uraExportRequest = z.strictObject({
  sessionId,
  target: z.enum(['agent-json', 'agent-xml', 'github']),
  verdict: uraVerdict.optional(),
});

const verdictChoiceRequest = z.strictObject({ sessionId, verdict: uraVerdict.optional() });

const maxMentionSpan = 5000;
const chatMention = z
  .strictObject({
    path: pathPrefix,
    side: z.enum(['head', 'base']),
    startLine: line.optional(),
    endLine: line.optional(),
    sha: commitSha,
  })
  .refine(
    (mention) => (mention.startLine === undefined) === (mention.endLine === undefined),
    'give both lines or neither',
  )
  .refine(
    (mention) =>
      mention.startLine === undefined ||
      mention.endLine === undefined ||
      (mention.endLine >= mention.startLine &&
        mention.endLine - mention.startLine < maxMentionSpan),
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
  .refine((id) => catalogIds.has(id), 'expected a catalog command')
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
const traceRemoveTrustRequest = z.strictObject({ repositoryPath: z.string().min(1).max(4096) });

const clipboardRequest = z.strictObject({ text: z.string().max(16 * 1024 * 1024) });

const githubAuthRequest = z.strictObject({ host: z.string().min(1).max(253).optional() });
const openPullRequestRequest = z.strictObject({
  ref: z.string().trim().min(1).max(2048),
  repoPath: z.string().trim().min(1).max(4096).optional(),
});
const githubReviewRequest = z.strictObject({ sessionId, verdict: uraVerdict.optional() });
const githubLinkRequest = z.strictObject({ url: z.string().min(1).max(8192) });

/**
 * Builds the invoke handlers. The renderer is untrusted, so each handler validates its argument
 * before anything reaches `services`, and answers bad input with an `invalid-request` error.
 */
export function createIpcHandlers(
  services: MainServices,
  appInfo: AppInfo,
  platform: IpcPlatform = {},
): IpcHandlers {
  return {
    'app:get-info': (request): IpcResult<AppInfo> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? ok(appInfo) : invalid(parsed.error);
    },
    'session:list': (request): IpcResult<readonly SessionSummary[]> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.sessions.list() : invalid(parsed.error);
    },
    'session:create-local': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = localSessionRequest.safeParse(request);
      return parsed.success ? services.sessions.createLocal(parsed.data) : invalid(parsed.error);
    },
    'repository:inspect': async (request): Promise<IpcResult<RepositoryInspectionView>> => {
      const parsed = inspectRepositoryRequest.safeParse(request);
      return parsed.success
        ? services.sessions.inspectRepository(parsed.data)
        : invalid(parsed.error);
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
      return ok(chosen === undefined ? { kind: 'cancelled' } : { kind: 'chosen', path: chosen });
    },
    'session:get-review': async (request): Promise<IpcResult<ReviewView>> => {
      const parsed = reviewRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, ignoreWhitespace } = parsed.data;
      return services.sessions.getReview({
        sessionId: id,
        ...(ignoreWhitespace !== undefined && { ignoreWhitespace }),
      });
    },
    'session:mark-reviewed': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = markReviewedRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, expectedHeadSha } = parsed.data;
      return services.sessions.markReviewed(
        expectedHeadSha === undefined ? { sessionId: id } : { sessionId: id, expectedHeadSha },
      );
    },
    'review:set-file-reviewed': async (request): Promise<IpcResult<SetFileReviewedResponse>> => {
      const parsed = fileReviewedRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, path, reviewed, expectedHeadSha } = parsed.data;
      return services.sessions.setFileReviewed({
        sessionId: id,
        path,
        reviewed,
        ...(expectedHeadSha !== undefined && { expectedHeadSha }),
      });
    },
    'session:get-order': async (request): Promise<IpcResult<ReviewOrderView>> => {
      const parsed = reviewOrderRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, mode } = parsed.data;
      return services.order.getOrder(
        mode === undefined ? { sessionId: id } : { sessionId: id, mode },
      );
    },
    'session:get-impact': async (request): Promise<IpcResult<ImpactView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success
        ? services.impact.getImpactForRenderer(parsed.data)
        : invalid(parsed.error);
    },
    'session:get-file-pair': async (request): Promise<IpcResult<FilePairView>> => {
      const parsed = filePairRequest.safeParse(request);
      return parsed.success ? services.files.getFilePair(parsed.data) : invalid(parsed.error);
    },
    'session:get-tree': async (request): Promise<IpcResult<RepositoryTreeView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.files.getTree(parsed.data) : invalid(parsed.error);
    },
    'session:get-file-attributes': async (request): Promise<IpcResult<FileAttributesView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.files.getFileAttributes(parsed.data) : invalid(parsed.error);
    },
    'lsp:call-hierarchy': async (request): Promise<IpcResult<CallHierarchyView>> => {
      const parsed = callHierarchyRequest.safeParse(request);
      return parsed.success
        ? services.lsp.callHierarchy(withoutUndefined(parsed.data))
        : invalid(parsed.error);
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
    'sheet:open': async (request): Promise<IpcResult<{ opened: true }>> => {
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
    'sheet:get-file': async (request): Promise<IpcResult<SheetFileView>> => {
      const parsed = sheetFileRequest.safeParse(request);
      return parsed.success ? services.sheets.getFile(parsed.data) : invalid(parsed.error);
    },
    'sheet:get-head': async (request): Promise<IpcResult<SheetHeadView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.sheets.getHead(parsed.data) : invalid(parsed.error);
    },
    'remote:permalink': async (request): Promise<IpcResult<PermalinkView>> => {
      const parsed = permalinkRequest.safeParse(request);
      return parsed.success
        ? services.remote.permalink(permalinkRequestFrom(parsed.data))
        : invalid(parsed.error);
    },
    'remote:open-permalink': async (request): Promise<IpcResult<PermalinkView>> => {
      const parsed = permalinkRequest.safeParse(request);
      return parsed.success
        ? services.remote.openPermalink(permalinkRequestFrom(parsed.data))
        : invalid(parsed.error);
    },
    'flow:get-graph': async (request): Promise<IpcResult<FlowGraphResponse>> => {
      const parsed = flowGraphRequest.safeParse(request);
      return parsed.success ? services.flow.getGraph(parsed.data) : invalid(parsed.error);
    },
    'trace:run': async (request): Promise<IpcResult<TraceRunStartedView>> => {
      const parsed = traceRunRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { testNamePattern, ...required } = parsed.data;
      return services.trace.run({
        ...required,
        ...(testNamePattern !== undefined && { testNamePattern }),
      });
    },
    'trace:cancel': (request): IpcResult<TraceCancelledView> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.trace.cancel(parsed.data) : invalid(parsed.error);
    },
    'trace:get-trust': async (request): Promise<IpcResult<TraceTrustView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.trace.getTrust(parsed.data) : invalid(parsed.error);
    },
    'trace:set-trust': async (request): Promise<IpcResult<TraceTrustView>> => {
      const parsed = traceTrustRequest.safeParse(request);
      return parsed.success ? services.trace.setTrust(parsed.data) : invalid(parsed.error);
    },
    'ura:list': async (request): Promise<IpcResult<UraListView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.ura.list(parsed.data) : invalid(parsed.error);
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
      return parsed.success ? services.ura.transition(parsed.data) : invalid(parsed.error);
    },
    'ura:reorder': (request): IpcResult<UraOrderView> => {
      const parsed = uraReorderRequest.safeParse(request);
      return parsed.success ? services.ura.reorder(parsed.data) : invalid(parsed.error);
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
    'ura:stage-impact-finding': async (request): Promise<IpcResult<UraStagedView>> => {
      const parsed = stageFindingRequest.safeParse(request);
      return parsed.success ? services.ura.stageImpactFinding(parsed.data) : invalid(parsed.error);
    },
    'ura:set-verdict': (request): IpcResult<UraVerdictStateView> => {
      const parsed = verdictChoiceRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, verdict } = parsed.data;
      return services.ura.setVerdict({ sessionId: id, ...(verdict !== undefined && { verdict }) });
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
            mentions: mentions.map(({ path, side, startLine, endLine, sha }) => ({
              path,
              side,
              ...(startLine !== undefined && endLine !== undefined && { startLine, endLine }),
              sha,
            })),
          }),
      });
    },
    'chat:list': (request): IpcResult<ChatListView> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.chat.list(parsed.data) : invalid(parsed.error);
    },
    'chat:cancel': (request): IpcResult<ChatCancelledView> => {
      const parsed = chatCancelRequest.safeParse(request);
      return parsed.success ? services.chat.cancel(parsed.data) : invalid(parsed.error);
    },
    'chat:compact': async (request): Promise<IpcResult<ChatCompactedView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.chat.compact(parsed.data) : invalid(parsed.error);
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
      return parsed.success ? services.editor.getSettings() : invalid(parsed.error);
    },
    'editor:set-preferred': async (request): Promise<IpcResult<EditorSettingsView>> => {
      const parsed = preferredEditorRequest.safeParse(request);
      return parsed.success ? services.editor.setPreferred(parsed.data) : invalid(parsed.error);
    },
    'github:auth-status': async (request): Promise<IpcResult<GithubAuthStatusView>> => {
      const parsed = githubAuthRequest.safeParse(request ?? {});
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { host } = parsed.data;
      return services.github.authStatus(host === undefined ? {} : { host });
    },
    'github:open-pr': async (request): Promise<IpcResult<OpenPullRequestResponse>> => {
      const parsed = openPullRequestRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { ref, repoPath } = parsed.data;
      return services.github.openPullRequest({
        ref,
        ...(repoPath !== undefined && { repoPath }),
      });
    },
    'display:get': async (request): Promise<IpcResult<DiffDisplayView>> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.display.get() : invalid(parsed.error);
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
      return parsed.success
        ? services.github.getPullRequest(parsed.data.sessionId)
        : invalid(parsed.error);
    },
    'github:preview-review': async (
      request,
    ): Promise<IpcResult<GithubReviewPreviewView | GithubFailureView>> => {
      const parsed = githubReviewRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, verdict } = parsed.data;
      return services.github.previewReview({
        sessionId: id,
        ...(verdict !== undefined && { verdict }),
      });
    },
    'github:post-review': async (request): Promise<IpcResult<PostGithubReviewResponse>> => {
      const parsed = githubReviewRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { sessionId: id, verdict } = parsed.data;
      return services.github.postReview({
        sessionId: id,
        ...(verdict !== undefined && { verdict }),
      });
    },
    'github:open-link': async (request): Promise<IpcResult<{ opened: true }>> => {
      const parsed = githubLinkRequest.safeParse(request);
      return parsed.success ? services.github.openLink(parsed.data) : invalid(parsed.error);
    },
    'menu:set-state': (request, sender): IpcResult<{ readonly applied: true }> => {
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
    'menu:context': (request, sender): IpcResult<{ readonly shown: boolean }> => {
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
    'menu:run-main': (request, sender): IpcResult<{ readonly ran: true }> => {
      const parsed = menuRunMainRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (sender === undefined || platform.menus === undefined) {
        return err({ code: 'not-wired', message: 'no menus outside Electron' });
      }
      return platform.menus.runMainCommand(sender.webContentsId, parsed.data.id)
        ? ok({ ran: true })
        : err({ code: 'refused', message: `${parsed.data.id} is not a main-process command` });
    },
    'trace:list-trust': async (request): Promise<IpcResult<readonly TraceTrustEntryView[]>> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.trace.listTrust() : invalid(parsed.error);
    },
    'trace:remove-trust': async (request): Promise<IpcResult<readonly TraceTrustEntryView[]>> => {
      const parsed = traceRemoveTrustRequest.safeParse(request);
      return parsed.success ? services.trace.removeTrust(parsed.data) : invalid(parsed.error);
    },
    'claude:status': async (request): Promise<IpcResult<ClaudeStatusView>> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.claude.status() : invalid(parsed.error);
    },
    'models:list': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = noRequest.safeParse(request);
      return parsed.success ? services.models.list() : invalid(parsed.error);
    },
    'models:save': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = saveModelRequest.safeParse(request);
      return parsed.success
        ? services.models.save(modelEntryInputFrom(parsed.data.entry))
        : invalid(parsed.error);
    },
    'models:remove': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelIdRequest.safeParse(request);
      return parsed.success ? services.models.remove(parsed.data.id) : invalid(parsed.error);
    },
    'models:set-role': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelRoleRequest.safeParse(request);
      return parsed.success
        ? services.models.setRole(parsed.data.role, parsed.data.id)
        : invalid(parsed.error);
    },
    'models:set-key': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelKeyRequest.safeParse(request);
      // Never echo the request: a validation message could quote the key.
      return parsed.success
        ? services.models.setKey(parsed.data.id, parsed.data.apiKey)
        : err({
            code: 'invalid-request',
            message: 'expected { id, apiKey } with a key of 1 to 4096 printable characters',
          });
    },
    'models:remove-key': async (request): Promise<IpcResult<ModelRegistryView>> => {
      const parsed = modelIdRequest.safeParse(request);
      return parsed.success ? services.models.removeKey(parsed.data.id) : invalid(parsed.error);
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
      return parsed.success ? services.models.test(parsed.data.id) : invalid(parsed.error);
    },
    'clipboard:write-text': async (request): Promise<IpcResult<{ length: number }>> => {
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
