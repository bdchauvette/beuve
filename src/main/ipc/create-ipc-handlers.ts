import { z } from 'zod';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Err } from '#pkg/result/result.ts';

import { normalizePathPrefix } from '#contract/normalize-path-prefix.ts';
import type {
  AppInfo,
  CallHierarchyRequest,
  CallHierarchyView,
  ChatAskedView,
  ChatCancelledView,
  ChatClearedView,
  ChatListView,
  EditorOpenResponse,
  EditorSettingsView,
  FilePairView,
  FlowGraphResponse,
  GithubAuthStatusView,
  GithubFailureView,
  GithubReviewPreviewView,
  ImpactView,
  InsightListView,
  InsightStatusChangeView,
  InvokeChannel,
  InvokeResponse,
  IpcError,
  IpcResult,
  OpenPullRequestResponse,
  PostGithubReviewResponse,
  PullRequestSessionView,
  ReviewRunHandleView,
  ReviewRunRequest,
  RepositoryTreeView,
  ReviewView,
  SessionSummary,
  UraExportView,
  UraItemView,
  UraListView,
  UraOrderView,
  UraStagedView,
  UraVerdictStateView,
} from '#contract/ipc-contract.ts';
import type { MainServices } from '../main-services.ts';

/** What the handlers need from Electron itself; tests pass a stub. */
export interface IpcPlatform {
  /** Absent outside Electron, where `clipboard:write-text` answers `not-wired`. */
  readonly writeClipboard?: (text: string) => Promise<void>;
}

/** One handler per invoke channel. Each takes the raw, untrusted renderer argument. */
export type IpcHandlers = {
  readonly [C in InvokeChannel]: (
    request: unknown,
  ) => InvokeResponse<C> | Promise<InvokeResponse<C>>;
};

const noRequest = z.undefined();
const sessionId = z.string().min(1).max(200);
const sessionRequest = z.strictObject({ sessionId });
const revision = z.string().trim().min(1).max(1024);
const localSessionRequest = z.strictObject({
  repoPath: z.string().min(1).max(4096),
  baseRef: revision,
  headRef: revision,
});
const markReviewedRequest = z.strictObject({
  sessionId,
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

const flowGraphRequest = z.strictObject({
  sessionId,
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(10_000_000),
});

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

const reviewRunRequest = z.strictObject({
  sessionId,
  pathPrefixes: z.array(pathPrefix).max(64).optional(),
  fresh: z.boolean().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
});

const uuid = z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u);
const commitSha = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/u);

const insightStatusRequest = z.strictObject({
  insightId: uuid,
  status: z.enum(['pending', 'promoted', 'dismissed']),
});

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

const promoteInsightRequest = z.strictObject({ insightId: uuid, severity: uraSeverity.optional() });

const stageFindingRequest = z.strictObject({
  sessionId,
  path: repositoryPath,
  functionName: z.string().min(1).max(1000),
});

const uraExportRequest = z.strictObject({
  sessionId,
  target: z.enum(['agent-json', 'agent-xml', 'github', 'markdown']),
  verdict: uraVerdict.optional(),
});

const verdictChoiceRequest = z.strictObject({ sessionId, verdict: uraVerdict.optional() });

const chatAskRequest = z.strictObject({
  sessionId,
  question: z.string().trim().min(1).max(8000),
  focus: z.strictObject({ path: repositoryPath, line: line.optional() }).optional(),
});

const chatCancelRequest = z.strictObject({ messageId: uuid });

const editorOpenRequest = z.strictObject({
  sessionId,
  path: pathPrefix,
  line,
  column: z.number().int().min(1).max(100_000).optional(),
});
const preferredEditorRequest = z.strictObject({ editorId: z.enum(['zed', 'vscode', 'cursor']) });

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
    'session:open': (request): IpcResult<SessionSummary> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.sessions.open(parsed.data) : invalid(parsed.error);
    },
    'session:create-local': async (request): Promise<IpcResult<SessionSummary>> => {
      const parsed = localSessionRequest.safeParse(request);
      return parsed.success ? services.sessions.createLocal(parsed.data) : invalid(parsed.error);
    },
    'session:get-review': async (request): Promise<IpcResult<ReviewView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.sessions.getReview(parsed.data) : invalid(parsed.error);
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
    'session:get-impact': async (request): Promise<IpcResult<ImpactView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.impact.getImpact(parsed.data) : invalid(parsed.error);
    },
    'session:get-file-pair': async (request): Promise<IpcResult<FilePairView>> => {
      const parsed = filePairRequest.safeParse(request);
      return parsed.success ? services.files.getFilePair(parsed.data) : invalid(parsed.error);
    },
    'session:get-tree': async (request): Promise<IpcResult<RepositoryTreeView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.files.getTree(parsed.data) : invalid(parsed.error);
    },
    'lsp:call-hierarchy': async (request): Promise<IpcResult<CallHierarchyView>> => {
      const parsed = callHierarchyRequest.safeParse(request);
      return parsed.success
        ? services.lsp.callHierarchy(withoutUndefined(parsed.data))
        : invalid(parsed.error);
    },
    'flow:get-graph': async (request): Promise<IpcResult<FlowGraphResponse>> => {
      const parsed = flowGraphRequest.safeParse(request);
      return parsed.success ? services.flow.getGraph(parsed.data) : invalid(parsed.error);
    },
    'review:run': async (request): Promise<IpcResult<ReviewRunHandleView>> => {
      const parsed = reviewRunRequest.safeParse(request);
      return parsed.success
        ? services.review.run(toRunRequest(parsed.data))
        : invalid(parsed.error);
    },
    'review:list-insights': async (request): Promise<IpcResult<InsightListView>> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.review.listInsights(parsed.data) : invalid(parsed.error);
    },
    'review:set-insight-status': (request): IpcResult<InsightStatusChangeView> => {
      const parsed = insightStatusRequest.safeParse(request);
      return parsed.success ? services.review.setInsightStatus(parsed.data) : invalid(parsed.error);
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
    'ura:promote-insight': async (request): Promise<IpcResult<UraStagedView>> => {
      const parsed = promoteInsightRequest.safeParse(request);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const { insightId, severity } = parsed.data;
      return services.ura.promoteInsight({
        insightId,
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
      const { focus, ...required } = parsed.data;
      return services.chat.ask({
        ...required,
        ...(focus !== undefined && {
          focus: { path: focus.path, ...(focus.line !== undefined && { line: focus.line }) },
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
    'chat:clear': (request): IpcResult<ChatClearedView> => {
      const parsed = sessionRequest.safeParse(request);
      return parsed.success ? services.chat.clear(parsed.data) : invalid(parsed.error);
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

function withoutUndefined(request: z.infer<typeof callHierarchyRequest>): CallHierarchyRequest {
  const { character, nodeId, ...required } = request;
  return {
    ...required,
    ...(character !== undefined && { character }),
    ...(nodeId !== undefined && { nodeId }),
  };
}

function toRunRequest(request: z.infer<typeof reviewRunRequest>): ReviewRunRequest {
  const { pathPrefixes, fresh, effort, ...required } = request;
  const prefixes = [...new Set(pathPrefixes)];
  return {
    ...required,
    ...(prefixes.length > 0 && { pathPrefixes: prefixes }),
    ...(fresh === true && { fresh }),
    ...(effort !== undefined && { effort }),
  };
}

function invalid(error: z.ZodError): Err<IpcError> {
  return err({ code: 'invalid-request', message: z.prettifyError(error) });
}
