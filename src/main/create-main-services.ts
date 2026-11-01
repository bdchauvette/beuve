import type { DatabaseSync } from 'node:sqlite';

import type {
  ClaudeStatusView,
  IpcResult,
  PullRequestBadgeView,
  ReviewView,
  SessionSummary,
} from '#contract/ipc-contract.ts';
import { createCachedCredentialProvider } from '#internal/auth/create-cached-credential-provider.ts';
import { createGhCliCredentialProvider } from '#internal/auth/create-gh-cli-credential-provider.ts';
import type { GithubCredentialProvider } from '#internal/auth/github-credential-provider.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { FetchLike } from '#internal/github/github-client.ts';
import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { createLspMultiplexer } from '#internal/lsp/create-lsp-multiplexer.ts';
import type { LspMultiplexerOptions } from '#internal/lsp/create-lsp-multiplexer.ts';
import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import { createSyntaxParser } from '#internal/syntax/create-syntax-parser.ts';
import type { SyntaxParserOptions } from '#internal/syntax/create-syntax-parser.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { createChatServices } from './chat/create-chat-services.ts';
import type { ChatServices } from './chat/create-chat-services.ts';
import { createDisplayServices } from './display/create-display-services.ts';
import { createEditorServices } from './editor/create-editor-services.ts';
import { createEditorSettings } from './editor/create-editor-settings.ts';
import { createReviewEditsServices } from './review-edits/create-review-edits-services.ts';
import type { EditorPlatform } from './editor/editor-platform.ts';
import { createSystemEditorPlatform } from './editor/create-system-editor-platform.ts';
import { createFileServices } from './files/create-file-services.ts';
import { createFlowServices } from './flow/create-flow-services.ts';
import { createClonePathSettings } from './github/create-clone-path-settings.ts';
import { createGithubClients } from './github/create-github-clients.ts';
import { createGithubServices } from './github/create-github-services.ts';
import type { GithubServices } from './github/create-github-services.ts';
import { createImpactServices } from './impact/create-impact-services.ts';
import type { ImpactServices } from './impact/create-impact-services.ts';
import { createImpactWorker } from './impact/create-impact-worker.ts';
import type { ImpactRunner } from './impact/create-impact-worker.ts';
import { createOrderServices } from './order/create-order-services.ts';
import { createLspServices } from './lsp/create-lsp-services.ts';
import { createTypescriptServer } from './lsp/create-typescript-server.ts';
import type { NodeRuntime, NodeRuntimeError } from './node-runtime/resolve-node-runtime.ts';
import type { MainServices, SessionServices } from './main-services.ts';
import { createMcpTools } from './mcp/create-mcp-tools.ts';
import type { ClaudeCodeSettings } from './chat/claude-code-settings.ts';
import { readClaudeStatus } from './chat/read-claude-status.ts';
import { createClaudeCodeVersionCheck } from './models/create-claude-code-version-check.ts';
import { createModelRegistryStore } from './models/create-model-registry-store.ts';
import { createModelServices } from './models/create-model-services.ts';
import { createSecretStore } from './models/create-secret-store.ts';
import type { SecretCipher } from './models/create-secret-store.ts';
import type { ModelResolverDeps } from './models/resolve-language-model.ts';
import { createSessionServices } from './sessions/create-session-services.ts';
import { createSheetServices } from './sheets/create-sheet-services.ts';
import { createRemoteServices } from './remote/create-remote-services.ts';
import { createShellServices } from './shell/create-shell-services.ts';
import { createGitCaches } from './sessions/create-git-caches.ts';
import type { SessionContext } from './sessions/session-context.ts';
import { createTraceServices } from './trace/create-trace-services.ts';
import type { TraceServices } from './trace/create-trace-services.ts';
import { createRepositoryTrust } from './trust/create-repository-trust.ts';
import { createTrustServices } from './trust/create-trust-services.ts';
import type { TraceRunner } from '#internal/trace/trace-runner.ts';
import { createUraServices } from './ura/create-ura-services.ts';
import type { UraServices } from './ura/create-ura-services.ts';
import { loadSession } from './sessions/load-session.ts';
import { createSessionWorktrees } from './worktrees/create-session-worktrees.ts';
import type { WorktreeKeep } from './worktrees/create-session-worktrees.ts';

export interface MainServicesOptions {
  /** An open, migrated database (see `openAppDatabase`). The caller closes it. */
  readonly db: DatabaseSync;
  readonly logger: Logger;
  /** Where session head checkouts live (ADR 0020): `<userData>/worktrees` in the app. */
  readonly worktreeRoot: string;
  /**
   * Where review-edits worktrees live (ADR 0088): `<userData>/review-edits` in the app; defaults
   * to `review-edits` beside `worktreeRoot`.
   */
  readonly reviewEditsRoot?: string;
  /**
   * The Node that runs the TypeScript language server and trace probes (ADR 0083), resolved once
   * at startup with `resolveNodeRuntime`. Without one, TypeScript has no language server and
   * every probe fails with the reason.
   */
  readonly nodeRuntime: Result<NodeRuntime, NodeRuntimeError>;
  readonly deps?: SessionDeps;
  readonly git?: OpenRepositoryOptions;
  /**
   * `false` turns off the shared git caches (ADR 0081): every probe, fork point and review diff
   * is computed again for each request. Only for the test that compares the two.
   */
  readonly caching?: boolean;
  /** The packaged app passes `wasmDirectory`; tests load grammars from `node_modules`. */
  readonly syntax?: SyntaxParserOptions;
  /**
   * The ImpactGate worker script (ADR 0053). The bundled app passes `dist/main/impact-worker.js`;
   * tests and `node` run the TypeScript source beside `create-impact-worker.ts`.
   */
  readonly impactWorkerUrl?: URL | string;
  /** Replaces the ImpactGate worker outright, so tests can hold a computation in flight. */
  readonly impactRunner?: ImpactRunner;
  /** Overrides for the language server multiplexer; its servers default to beuve's TypeScript. */
  readonly lsp?: LspMultiplexerOptions;
  /** How the chat finds and runs Claude Code (ADR 0022, 0031, 0055); tests pass the fake. */
  readonly claude?: ClaudeCodeSettings;
  /**
   * The model registry (ADR 0070): `settingsPath` holds it (in memory without), `secretsPath`
   * the encrypted API keys, `cipher` Electron's `safeStorage` (keys can't be stored without it),
   * `bundledClaudeCodePath` the packaged Claude Code binary and `agentSdk` test settings.
   */
  readonly models?: {
    readonly settingsPath?: string;
    readonly secretsPath?: string;
    readonly cipher?: SecretCipher;
    readonly bundledClaudeCodePath?: string;
    readonly hasBundledClaudeCode?: boolean;
    readonly agentSdk?: ModelResolverDeps['agentSdk'];
  };
  /**
   * The editor launcher (ADR 0033): `settingsPath` is the JSON file holding the preferred editor
   * (in memory without it), `platform` replaces the real machine. Tests must pass a fake platform.
   */
  readonly editor?: {
    readonly settingsPath?: string;
    readonly platform?: EditorPlatform;
  };
  /** Diff display preferences (ADR 0042), in memory without `settingsPath`. */
  readonly display?: { readonly settingsPath?: string };
  /**
   * Trace probes (ADR 0036, 0041): `settingsPath` holds the per-repository approvals (in memory
   * without it), `temporaryDirectory` where runs work, `timeout` the longest a probe may run.
   * Tests may pass a `runner`.
   */
  readonly trace?: {
    readonly settingsPath?: string;
    readonly temporaryDirectory?: string;
    readonly timeout?: Temporal.Duration;
    readonly runner?: TraceRunner;
  };
  /**
   * GitHub (ADR 0034, 0037–0040). `credentials` defaults to the gh CLI and is always wrapped in the
   * short-lived token cache; tests must pass a fake one and a fake `fetch`. `apiBase` is a
   * development-only API root, `settingsPath` where remembered clone paths live, `openExternal`
   * the system browser for allow-listed links. `polling.scheduled: false` leaves polling to
   * explicit `pollNow` calls.
   */
  /** `openExternal` is the system browser for any http(s) link in a chat answer. */
  readonly shell?: {
    readonly openExternal?: (url: string) => Promise<void>;
  };
  readonly github?: {
    readonly credentials?: GithubCredentialProvider;
    readonly fetch?: FetchLike;
    readonly apiBase?: URL;
    readonly settingsPath?: string;
    readonly openExternal?: (url: string) => Promise<void>;
    readonly polling?: { readonly interval?: Temporal.Duration; readonly scheduled?: boolean };
  };
}

/**
 * Composes the domains behind the IPC handlers and MCP tools. Needs nothing from Electron. The
 * caller owns the result's language servers and must `dispose` it.
 */
export function createMainServices(options: MainServicesOptions): MainServices {
  const { logger } = options;
  const heads: {
    ura: UraServices | undefined;
    chat: ChatServices | undefined;
    trace: TraceServices | undefined;
    impact: ImpactServices | undefined;
  } = { ura: undefined, chat: undefined, trace: undefined, impact: undefined };
  const onHeadMoved = (sessionId: string, headSha: CommitSha): void => {
    heads.ura?.observeHead(sessionId);
    heads.chat?.observeHead(sessionId, headSha);
    heads.trace?.observeHead(sessionId, headSha);
    heads.impact?.observeHead(sessionId, headSha);
  };
  const caches = createGitCaches({ enabled: options.caching !== false, logger });
  const context: SessionContext = {
    db: options.db,
    logger,
    deps: options.deps ?? systemSessionDeps,
    git: {
      ...options.git,
      logger: options.git?.logger ?? logger,
      objectReaders: caches.objectReaders,
    },
    caches,
    onHeadMoved,
  };
  const open: OpenSession = { sessionId: undefined };
  const gh: { services: GithubServices | undefined } = { services: undefined };
  const sessions = withPullRequestBadges(
    trackOpenSession(
      createSessionServices({ ...options, onHeadMoved, caches }),
      open,
      (id, isPull) => {
        if (isPull) {
          gh.services?.watch(id);
        } else {
          gh.services?.watch(undefined);
        }
      },
    ),
    (summary): PullRequestBadgeView | undefined => {
      if (summary.source.kind === 'github-pull-request') {
        return gh.services?.badgeFor(summary.source);
      }
      return undefined;
    },
  );
  const parser = createSyntaxParser(options.syntax);
  const impactRunner =
    options.impactRunner ??
    createImpactWorker({
      logger,
      workerUrl: options.impactWorkerUrl,
      wasmDirectory: options.syntax?.wasmDirectory,
      maxSourceLength: options.syntax?.maxSourceLength,
    });
  const impact = createImpactServices({ context, runner: impactRunner });
  heads.impact = impact;
  const multiplexer = createLspMultiplexer({
    servers: languageServersFor(options.nodeRuntime),
    trustWorkspaceBinaries: false,
    logger,
    ...options.lsp,
  });
  const worktrees = createSessionWorktrees({
    root: options.worktreeRoot,
    ...(options.reviewEditsRoot !== undefined && { editsRoot: options.reviewEditsRoot }),
    logger,
    git: context.git,
    storedHead: (sessionId): CommitSha | undefined => {
      const stored = loadSession(context, sessionId);
      if (stored.ok) {
        return stored.value.headSha;
      }
      return undefined;
    },
  });
  const lsp = createLspServices({ context, multiplexer, worktrees });
  const registry = createModelRegistryStore(options.models?.settingsPath);
  const secrets = createSecretStore({
    ...(options.models?.secretsPath !== undefined && { filePath: options.models.secretsPath }),
    ...(options.models?.cipher !== undefined && { cipher: options.models.cipher }),
  });
  const chat = createChatServices({
    context,
    impact,
    worktrees,
    models: {
      registry,
      secrets,
      claude: options.claude ?? {},
      logger,
      checkClaudeCodeVersion: createClaudeCodeVersionCheck(),
      ...(options.models?.bundledClaudeCodePath !== undefined && {
        bundledClaudeCodePath: options.models.bundledClaudeCodePath,
      }),
      ...(options.models?.agentSdk !== undefined && { agentSdk: options.models.agentSdk }),
    },
    ...(options.claude !== undefined && { claude: options.claude }),
    intentFor: (sessionId) => {
      return gh.services?.intentFor(sessionId);
    },
  });
  heads.chat = chat;
  const ura = createUraServices({ context, impact });
  heads.ura = ura;
  const repositoryTrust = createRepositoryTrust({
    db: options.db,
    logger,
    legacySettingsPath: options.trace?.settingsPath,
  });
  const trust = createTrustServices({ context, trust: repositoryTrust });
  const trace = createTraceServices({
    context,
    worktrees,
    parse: parser.parse,
    trust: repositoryTrust,
    nodeRuntime: options.nodeRuntime,
    ...(options.trace?.runner !== undefined && { runner: options.trace.runner }),
    ...(options.trace?.temporaryDirectory !== undefined && {
      temporaryDirectory: options.trace.temporaryDirectory,
    }),
    ...(options.trace?.timeout !== undefined && { timeout: options.trace.timeout }),
  });
  heads.trace = trace;
  const credentials = createCachedCredentialProvider(
    options.github?.credentials ?? createGhCliCredentialProvider({ logger }),
  );
  const github = createGithubServices({
    context,
    clients: createGithubClients({
      credentials,
      ...(options.github?.fetch !== undefined && { fetch: options.github.fetch }),
      ...(options.github?.apiBase !== undefined && { apiBase: options.github.apiBase }),
      logger,
    }),
    clonePaths: createClonePathSettings(options.github?.settingsPath),
    ura,
    ...(options.github?.openExternal !== undefined && {
      openExternal: options.github.openExternal,
    }),
    ...(options.github?.polling !== undefined && { polling: options.github.polling }),
    openSessionId: () => {
      return open.sessionId;
    },
  });
  gh.services = github;
  const files = createFileServices({ context });
  const display = createDisplayServices(options.display?.settingsPath);
  const editorSettings = createEditorSettings(options.editor?.settingsPath);
  const editor = createEditorServices({
    context,
    worktrees,
    settings: editorSettings,
    platform: options.editor?.platform ?? createSystemEditorPlatform(),
  });
  return {
    sessions,
    impact,
    files,
    order: createOrderServices({
      context,
      parse: parser.parse,
      callHierarchy: lsp.callHierarchy,
      getFileAttributes: files.getFileAttributes,
      defaultMode: async () => {
        const shown = await display.get();
        if (shown.ok) {
          return shown.value.reviewOrder ?? 'path';
        }
        return 'path';
      },
    }),
    lsp,
    sheets: createSheetServices({ context, ura }),
    remote: createRemoteServices({
      context,
      ...(options.github?.openExternal !== undefined && {
        openExternal: options.github.openExternal,
      }),
    }),
    shell: createShellServices({
      ...(options.shell?.openExternal !== undefined && {
        openExternal: options.shell.openExternal,
      }),
    }),
    flow: createFlowServices({ context, parse: parser.parse }),
    editor,
    reviewEdits: createReviewEditsServices({
      context,
      worktrees,
      ura,
      editor,
      settings: editorSettings,
    }),
    display,
    chat,
    ura,
    trace,
    trust,
    github,
    claude: {
      status: async (): Promise<IpcResult<ClaudeStatusView>> => {
        return ok(await readClaudeStatus(options.claude ?? {}));
      },
    },
    models: createModelServices({
      registry,
      secrets,
      testModel: chat.testModel,
      hasBundledClaudeCode: options.models?.hasBundledClaudeCode ?? false,
      logger,
    }),
    mcpTools: createMcpTools({
      context,
      impact,
      lsp,
      ura,
      trace,
      github,
      openSessionId: () => {
        return open.sessionId;
      },
    }),
    pruneWorktrees: async (): Promise<void> => {
      const stored = listSessions(options.db);
      let keep: WorktreeKeep[] = [];
      if (stored.ok) {
        keep = stored.value.map((session) => {
          return { repoPath: session.source.repoPath, headSha: session.headSha };
        });
      }
      await worktrees.prune(keep);
    },
    dispose: async (): Promise<void> => {
      github.dispose();
      await Promise.all([chat.dispose(), trace.dispose()]);
      impactRunner.dispose();
      await multiplexer.dispose();
      await worktrees.settled();
      await caches[Symbol.asyncDispose]();
    },
  };
}

/** The session the reviewer last opened, if any; shared with the MCP tools. */
interface OpenSession {
  sessionId: string | undefined;
}

function languageServersFor(
  nodeRuntime: Result<NodeRuntime, NodeRuntimeError>,
): ServerDefinition[] {
  if (nodeRuntime.ok) {
    return [createTypescriptServer(nodeRuntime.value)];
  }
  return [];
}

function summaryOf(value: ReviewView | SessionSummary): SessionSummary {
  if ('session' in value) {
    return value.session;
  }
  return value;
}

/**
 * Remembers the session the reviewer last opened, which agents get when they name none, and
 * tells `onOpened` whether it is a pull request (which main then polls, ADR 0038).
 */
function trackOpenSession(
  sessions: SessionServices,
  open: OpenSession,
  onOpened: (sessionId: string, isPullRequest: boolean) => void,
): SessionServices {
  const remember = <T extends ReviewView | SessionSummary>(result: IpcResult<T>): IpcResult<T> => {
    if (result.ok) {
      const value: ReviewView | SessionSummary = result.value;
      const summary = summaryOf(value);
      open.sessionId = summary.id;
      onOpened(summary.id, summary.source.kind === 'github-pull-request');
    }
    return result;
  };
  return {
    ...sessions,
    getReview: async (request, call): Promise<IpcResult<ReviewView>> => {
      return remember(await sessions.getReview(request, call));
    },
  };
}

/** Adds each pull request session's stored title and state to `session:list` (ADR 0037). */
function withPullRequestBadges(
  sessions: SessionServices,
  badgeFor: (summary: SessionSummary) => SessionSummary['pullRequest'],
): SessionServices {
  return {
    ...sessions,
    list: (): IpcResult<readonly SessionSummary[]> => {
      const listed = sessions.list();
      if (!listed.ok) {
        return listed;
      }
      return {
        ok: true,
        value: listed.value.map((summary) => {
          const badge = badgeFor(summary);
          if (badge === undefined) {
            return summary;
          }
          return { ...summary, pullRequest: badge };
        }),
      };
    },
  };
}
