import type { DatabaseSync } from 'node:sqlite';

import type { IpcResult, ReviewView, SessionSummary } from '#contract/ipc-contract.ts';
import { createCachedCredentialProvider } from '#internal/auth/create-cached-credential-provider.ts';
import { createGhCliCredentialProvider } from '#internal/auth/create-gh-cli-credential-provider.ts';
import type { GithubCredentialProvider } from '#internal/auth/github-credential-provider.ts';
import type { FetchLike } from '#internal/github/github-client.ts';
import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { createLspMultiplexer } from '#internal/lsp/create-lsp-multiplexer.ts';
import type { LspMultiplexerOptions } from '#internal/lsp/create-lsp-multiplexer.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import { createSyntaxParser } from '#internal/syntax/create-syntax-parser.ts';
import type { SyntaxParserOptions } from '#internal/syntax/create-syntax-parser.ts';
import type { Logger } from '#x/log/create-logger.ts';

import { createChatServices } from './chat/create-chat-services.ts';
import type { ChatServices } from './chat/create-chat-services.ts';
import { createDisplayServices } from './display/create-display-services.ts';
import { createEditorServices } from './editor/create-editor-services.ts';
import { createEditorSettings } from './editor/create-editor-settings.ts';
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
import type { MainServices, SessionServices } from './main-services.ts';
import { createMcpTools } from './mcp/create-mcp-tools.ts';
import type { ClaudeCodeSettings } from './chat/claude-code-settings.ts';
import { createSessionServices } from './sessions/create-session-services.ts';
import type { SessionContext } from './sessions/session-context.ts';
import { createTraceServices } from './trace/create-trace-services.ts';
import type { TraceServices } from './trace/create-trace-services.ts';
import { createTraceTrust } from './trace/create-trace-trust.ts';
import type { TraceRunner } from '#internal/trace/trace-runner.ts';
import { createUraServices } from './ura/create-ura-services.ts';
import type { UraServices } from './ura/create-ura-services.ts';
import { createSessionWorktrees } from './worktrees/create-session-worktrees.ts';

export interface MainServicesOptions {
  /** An open, migrated database (see `openAppDatabase`). The caller closes it. */
  readonly db: DatabaseSync;
  readonly logger: Logger;
  /** Where session head checkouts live (ADR 0020): `<userData>/worktrees` in the app. */
  readonly worktreeRoot: string;
  readonly deps?: SessionDeps;
  readonly git?: OpenRepositoryOptions;
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
  const onHeadMoved = (sessionId: string, headSha: string): void => {
    heads.ura?.observeHead(sessionId);
    heads.chat?.observeHead(sessionId, headSha);
    heads.trace?.observeHead(sessionId, headSha);
    heads.impact?.observeHead(sessionId, headSha);
  };
  const context: SessionContext = {
    db: options.db,
    logger,
    deps: options.deps ?? systemSessionDeps,
    git: { ...options.git, logger: options.git?.logger ?? logger },
    onHeadMoved,
  };
  const open: { sessionId: string | undefined } = { sessionId: undefined };
  const gh: { services: GithubServices | undefined } = { services: undefined };
  const sessions = withPullRequestBadges(
    trackOpenSession(createSessionServices({ ...options, onHeadMoved }), open, (id, isPull) => {
      gh.services?.watch(isPull ? id : undefined);
    }),
    (summary) =>
      summary.source.kind === 'github-pull-request'
        ? gh.services?.badgeFor(summary.source)
        : undefined,
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
    servers: [createTypescriptServer()],
    trustWorkspaceBinaries: false,
    logger,
    ...options.lsp,
  });
  const worktrees = createSessionWorktrees({
    root: options.worktreeRoot,
    logger,
    git: context.git,
  });
  const lsp = createLspServices({ context, multiplexer, worktrees });
  const chat = createChatServices({
    context,
    impact,
    worktrees,
    ...(options.claude !== undefined && { claude: options.claude }),
    intentFor: (sessionId) => gh.services?.intentFor(sessionId),
  });
  heads.chat = chat;
  const ura = createUraServices({ context, impact });
  heads.ura = ura;
  const trace = createTraceServices({
    context,
    worktrees,
    parse: parser.parse,
    trust: createTraceTrust({ settingsPath: options.trace?.settingsPath }),
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
    openSessionId: () => open.sessionId,
  });
  gh.services = github;
  const files = createFileServices({ context });
  const display = createDisplayServices(options.display?.settingsPath);
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
        return (shown.ok ? shown.value.reviewOrder : undefined) ?? 'path';
      },
    }),
    lsp,
    flow: createFlowServices({ context, parse: parser.parse }),
    editor: createEditorServices({
      context,
      worktrees,
      settings: createEditorSettings(options.editor?.settingsPath),
      platform: options.editor?.platform ?? createSystemEditorPlatform(),
    }),
    display,
    chat,
    ura,
    trace,
    github,
    mcpTools: createMcpTools({
      context,
      impact,
      lsp,
      ura,
      trace,
      github,
      openSessionId: () => open.sessionId,
    }),
    pruneWorktrees: async (): Promise<void> => {
      const stored = listSessions(options.db);
      await worktrees.prune(
        stored.ok
          ? stored.value.map((session) => ({
              repoPath: session.source.repoPath,
              headSha: session.headSha,
            }))
          : [],
      );
    },
    dispose: async (): Promise<void> => {
      github.dispose();
      await Promise.all([chat.dispose(), trace.dispose()]);
      impactRunner.dispose();
      await multiplexer.dispose();
    },
  };
}

/**
 * Remembers the session the reviewer last opened, which agents get when they name none, and
 * tells `onOpened` whether it is a pull request (which main then polls, ADR 0038).
 */
function trackOpenSession(
  sessions: SessionServices,
  open: { sessionId: string | undefined },
  onOpened: (sessionId: string, isPullRequest: boolean) => void,
): SessionServices {
  const remember = <T extends ReviewView | SessionSummary>(result: IpcResult<T>): IpcResult<T> => {
    if (result.ok) {
      const value: ReviewView | SessionSummary = result.value;
      const summary = 'session' in value ? value.session : value;
      open.sessionId = summary.id;
      onOpened(summary.id, summary.source.kind === 'github-pull-request');
    }
    return result;
  };
  return {
    ...sessions,
    getReview: async (request): Promise<IpcResult<ReviewView>> =>
      remember(await sessions.getReview(request)),
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
          return badge === undefined ? summary : { ...summary, pullRequest: badge };
        }),
      };
    },
  };
}
