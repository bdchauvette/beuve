import type { DatabaseSync } from 'node:sqlite';

import type { IpcResult, ReviewView, SessionSummary } from '#contract/ipc-contract.ts';
import type { OpenRepositoryOptions } from '#internal/git/open-repository.ts';
import { createLspMultiplexer } from '#internal/lsp/create-lsp-multiplexer.ts';
import type { LspMultiplexerOptions } from '#internal/lsp/create-lsp-multiplexer.ts';
import { listSessions } from '#internal/session/list-sessions.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { systemSessionDeps } from '#internal/session/system-session-deps.ts';
import { createSyntaxParser } from '#internal/syntax/create-syntax-parser.ts';
import type { SyntaxParserOptions } from '#internal/syntax/create-syntax-parser.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';

import { createImpactServices } from './impact/create-impact-services.ts';
import { createLspServices } from './lsp/create-lsp-services.ts';
import { createTypescriptServer } from './lsp/create-typescript-server.ts';
import type { MainServices, SessionServices } from './main-services.ts';
import { createMcpTools } from './mcp/create-mcp-tools.ts';
import { createReviewServices } from './review/create-review-services.ts';
import type { ClaudeCodeSettings, ReviewServices } from './review/create-review-services.ts';
import { createSessionServices } from './sessions/create-session-services.ts';
import type { SessionContext } from './sessions/session-context.ts';
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
  /** Overrides for the language server multiplexer; its servers default to beuve's TypeScript. */
  readonly lsp?: LspMultiplexerOptions;
  /** How the preliminary review finds and runs Claude Code (ADR 0022); tests pass the fake. */
  readonly claude?: ClaudeCodeSettings;
}

/**
 * Composes the domains behind the IPC handlers and MCP tools. Needs nothing from Electron. The
 * caller owns the result's language servers and must `dispose` it.
 */
export function createMainServices(options: MainServicesOptions): MainServices {
  const { logger } = options;
  const heads: { review: ReviewServices | undefined } = { review: undefined };
  const onHeadMoved = (sessionId: string, headSha: string): void => {
    heads.review?.observeHead(sessionId, headSha);
  };
  const context: SessionContext = {
    db: options.db,
    logger,
    deps: options.deps ?? systemSessionDeps,
    git: { ...options.git, logger: options.git?.logger ?? logger },
    onHeadMoved,
  };
  const open: { sessionId: string | undefined } = { sessionId: undefined };
  const sessions = trackOpenSession(createSessionServices({ ...options, onHeadMoved }), open);
  const parser = createSyntaxParser(options.syntax);
  const impact = createImpactServices({ context, parse: parser.parse });
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
  const review = createReviewServices({
    context,
    impact,
    worktrees,
    ...(options.claude !== undefined && { claude: options.claude }),
  });
  heads.review = review;
  return {
    sessions,
    impact,
    lsp,
    review,
    mcpTools: createMcpTools({ context, impact, lsp, openSessionId: () => open.sessionId }),
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
      await review.dispose();
      await multiplexer.dispose();
    },
  };
}

/** Remembers the session the reviewer last opened, which agents get when they name none. */
function trackOpenSession(
  sessions: SessionServices,
  open: { sessionId: string | undefined },
): SessionServices {
  const remember = <T extends ReviewView | SessionSummary>(result: IpcResult<T>): IpcResult<T> => {
    if (result.ok) {
      open.sessionId = 'session' in result.value ? result.value.session.id : result.value.id;
    }
    return result;
  };
  return {
    ...sessions,
    open: (request): IpcResult<SessionSummary> => remember(sessions.open(request)),
    getReview: async (request): Promise<IpcResult<ReviewView>> =>
      remember(await sessions.getReview(request)),
  };
}
