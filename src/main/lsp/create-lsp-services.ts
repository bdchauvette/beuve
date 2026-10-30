import path from 'node:path';

import type {
  CallHierarchyCallView,
  CallHierarchyNodeView,
  CallHierarchyRequest,
  CallHierarchyView,
  IpcError,
  IpcResult,
} from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { badgeCallHierarchyNode } from '#internal/lsp/badge-call-hierarchy-node.ts';
import type { ChangedLines } from '#internal/lsp/badge-call-hierarchy-node.ts';
import type { LspMultiplexer } from '#internal/lsp/create-lsp-multiplexer.ts';
import { findEnclosingSymbol } from '#internal/lsp/find-enclosing-symbol.ts';
import type { LspError } from '#internal/lsp/lsp-error.ts';
import type {
  CallHierarchyCall,
  CallHierarchyNode,
  DiagnosticsFreshness,
  DiagnosticSeverity,
  DiagnosticView,
  DocumentSymbolView,
  Position,
} from '#internal/lsp/lsp-model.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err, Result } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import { ipcErrorFromLspError } from './ipc-error-from-lsp-error.ts';
import { headSpansFrom } from './head-spans-from.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

/** Diagnostics for agents: lines and columns are 1-based, columns in UTF-16 code units. */
export interface AgentDiagnosticsReport {
  readonly sessionId: string;
  readonly headSha: string;
  readonly path: string;
  readonly serverId: string;
  readonly freshness: DiagnosticsFreshness;
  readonly diagnostics: readonly AgentDiagnostic[];
}

export interface AgentDiagnostic {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: DiagnosticSeverity | 'unspecified';
  readonly code?: string;
  readonly source?: string;
  readonly message: string;
}

/** Language-server features over a checkout of the session head (ADR 0020). */
export interface LspServices {
  readonly callHierarchy: (request: CallHierarchyRequest) => Promise<IpcResult<CallHierarchyView>>;
  readonly diagnostics: (request: {
    readonly sessionId: string;
    readonly path: string;
  }) => Promise<Result<AgentDiagnosticsReport, IpcError>>;
}

export interface LspServicesOptions {
  readonly context: SessionContext;
  readonly multiplexer: LspMultiplexer;
  readonly worktrees: SessionWorktrees;
}

interface Workspace {
  readonly root: string;
  readonly repository: GitRepository;
}

/**
 * Wires the LSP multiplexer to sessions: every request refreshes the session, makes sure its head
 * is checked out, and runs the server there, never in the user's own working tree. Call hierarchy
 * nodes are badged against the head-side lines of the review diff.
 */
export function createLspServices(options: LspServicesOptions): LspServices {
  const { context, multiplexer, worktrees } = options;
  const { logger } = context;
  const spansBySession = new Map<string, ChangedLines>();

  const checkout = async (
    sessionId: string,
    repository: GitRepository,
    headSha: CommitSha,
  ): Promise<Result<Workspace, IpcError>> => {
    const root = await worktrees.ensure(repository, sessionId, headSha);
    return root.ok ? ok({ root: root.value, repository }) : gitFailure(logger, root.error);
  };

  const fail = (error: LspError): Err<IpcError> => {
    logger.warn('language server request failed', { error });
    return err(ipcErrorFromLspError(error));
  };

  const expand = async (
    nodeId: string,
    direction: CallHierarchyRequest['direction'],
    spans: ChangedLines,
  ): Promise<Result<readonly CallHierarchyCallView[], IpcError>> => {
    const calls =
      direction === 'incoming'
        ? await multiplexer.incomingCalls(nodeId)
        : await multiplexer.outgoingCalls(nodeId);
    return calls.ok ? ok(calls.value.map((call) => callViewFrom(call, spans))) : fail(calls.error);
  };

  const locate = async (
    workspace: Workspace,
    request: CallHierarchyRequest,
    file: string,
    spans: ChangedLines,
  ): Promise<Result<Position, IpcError>> => {
    const line = request.line - 1;
    if (request.character !== undefined) {
      return ok({ line, character: request.character });
    }
    const symbols = await multiplexer.documentSymbols({ root: workspace.root, path: file });
    if (!symbols.ok) {
      return fail(symbols.error);
    }
    const span = spans
      .get(file)
      ?.find(
        (candidate) => candidate.startLine <= request.line && candidate.endLine >= request.line,
      );
    const symbol =
      findEnclosingSymbol(symbols.value, line) ??
      (span === undefined ? undefined : findFirstCallable(symbols.value, line, span.endLine - 1));
    return symbol === undefined
      ? err({
          code: 'not-found',
          message: `no function, method or constructor encloses line ${String(request.line)} of ${file}`,
        })
      : ok(symbol.selectionRange.start);
  };

  return {
    callHierarchy: async (request): Promise<IpcResult<CallHierarchyView>> => {
      const stopwatch = new Stopwatch();
      const cachedSpans = spansBySession.get(request.sessionId);
      if (cachedSpans !== undefined && request.nodeId !== undefined) {
        const calls = await expand(request.nodeId, request.direction, cachedSpans);
        return calls.ok ? ok({ direction: request.direction, calls: calls.value }) : calls;
      }
      const diff = await loadReviewDiff(context, request.sessionId);
      if (!diff.ok) {
        return diff;
      }
      const { session, repository } = diff.value.refreshed;
      const spans = headSpansFrom(diff.value.files);
      spansBySession.set(request.sessionId, spans);
      if (request.nodeId !== undefined) {
        const calls = await expand(request.nodeId, request.direction, spans);
        return calls.ok ? ok({ direction: request.direction, calls: calls.value }) : calls;
      }
      const workspace = await checkout(session.id, repository, session.headSha);
      if (!workspace.ok) {
        return workspace;
      }
      const file = relativeFrom(repository, request.path);
      const position = await locate(workspace.value, request, file, spans);
      if (!position.ok) {
        return position;
      }
      const roots = await multiplexer.prepareCallHierarchy({
        root: workspace.value.root,
        path: file,
        position: position.value,
      });
      if (!roots.ok) {
        return fail(roots.error);
      }
      const [root] = roots.value;
      if (root === undefined) {
        return err({
          code: 'not-found',
          message: `nothing callable at line ${String(request.line)}`,
        });
      }
      const calls = await expand(root.id, request.direction, spans);
      logger.debug('call hierarchy', {
        path: file,
        direction: request.direction,
        duration: stopwatch.elapsed(),
      });
      return calls.ok
        ? ok({ direction: request.direction, root: nodeViewFrom(root, spans), calls: calls.value })
        : calls;
    },

    diagnostics: async ({
      sessionId,
      path: requested,
    }): Promise<Result<AgentDiagnosticsReport, IpcError>> => {
      const stopwatch = new Stopwatch();
      const loaded = loadSession(context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const refreshed = await refreshSession(context, loaded.value);
      if (!refreshed.ok) {
        return refreshed;
      }
      const { session, repository } = refreshed.value;
      const workspace = await checkout(session.id, repository, session.headSha);
      if (!workspace.ok) {
        return workspace;
      }
      const file = relativeFrom(repository, requested);
      const report = await multiplexer.getDiagnostics({ root: workspace.value.root, path: file });
      if (!report.ok) {
        return fail(report.error);
      }
      logger.debug('diagnostics', {
        path: file,
        freshness: report.value.freshness,
        duration: stopwatch.elapsed(),
      });
      return ok({
        sessionId: session.id,
        headSha: session.headSha,
        path: report.value.path,
        serverId: report.value.serverId,
        freshness: report.value.freshness,
        diagnostics: report.value.diagnostics.map((diagnostic) => agentDiagnosticFrom(diagnostic)),
      });
    },
  };
}

const callableKinds = new Set(['function', 'method', 'constructor']);

/**
 * The first callable declared within 0-based lines `from`–`to`, for a change that starts outside
 * any function (an added file's imports): the peek then roots at the first function it adds.
 */
function findFirstCallable(
  symbols: readonly DocumentSymbolView[],
  from: number,
  to: number,
): DocumentSymbolView | undefined {
  let first: DocumentSymbolView | undefined;
  const visit = (candidates: readonly DocumentSymbolView[]): void => {
    for (const symbol of candidates) {
      const start = symbol.range.start.line;
      if (
        callableKinds.has(symbol.kind) &&
        start >= from &&
        start <= to &&
        (first === undefined || start < first.range.start.line)
      ) {
        first = symbol;
      }
      visit(symbol.children);
    }
  };
  visit(symbols);
  return first;
}

/** Agents often pass paths in the user's checkout; those map to the same relative path. */
function relativeFrom(repository: GitRepository, requested: string): string {
  if (!path.isAbsolute(requested)) {
    return requested;
  }
  const relative = path.relative(repository.root, requested);
  return relative.startsWith('..') || path.isAbsolute(relative) ? requested : relative;
}

function callViewFrom(call: CallHierarchyCall, spans: ChangedLines): CallHierarchyCallView {
  return {
    node: nodeViewFrom(call.node, spans),
    callSiteLines: [...new Set(call.callSites.map((range) => range.start.line + 1))],
  };
}

function nodeViewFrom(node: CallHierarchyNode, spans: ChangedLines): CallHierarchyNodeView {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    ...(node.detail !== undefined && node.detail !== '' && { detail: node.detail }),
    file: { ...node.file },
    startLine: node.range.start.line + 1,
    endLine: node.range.end.line + 1,
    selectionLine: node.selectionRange.start.line + 1,
    badge: badgeCallHierarchyNode(node, spans),
  };
}

function agentDiagnosticFrom(diagnostic: DiagnosticView): AgentDiagnostic {
  const { start, end } = diagnostic.range;
  return {
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    severity: diagnostic.severity ?? 'unspecified',
    ...(diagnostic.code !== undefined && { code: diagnostic.code }),
    ...(diagnostic.source !== undefined && { source: diagnostic.source }),
    message: diagnostic.message,
  };
}
