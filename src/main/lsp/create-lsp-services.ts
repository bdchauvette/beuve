import path from 'node:path';

import type {
  CallHierarchyCallView,
  CallHierarchyNodeView,
  CallHierarchyRequest,
  CallHierarchyView,
  DefinitionRequest,
  DefinitionTargetView,
  DefinitionView,
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
import { planDefinitionProbes } from '#internal/lsp/plan-definition-probes.ts';
import type { ProbeToken } from '#internal/lsp/plan-definition-probes.ts';
import type {
  CallHierarchyCall,
  CallHierarchyNode,
  DiagnosticsFreshness,
  DiagnosticSeverity,
  DiagnosticView,
  DocumentSymbolView,
  LocationView,
  Position,
  Range,
} from '#internal/lsp/lsp-model.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err, Result } from '#x/result/result.ts';

import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { readSheetSource } from '../sheets/read-sheet-source.ts';
import { resolveSheetCommit } from '../sheets/resolve-sheet-commit.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';
import { worktreeFailure } from '../worktrees/worktree-failure.ts';

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
  /**
   * Where the symbol on a line is defined (ADR 0067), in a checkout of the requested commit: the
   * session head's own (ADR 0020), or, for a sheet pinned to an older commit, a checkout of that
   * commit kept until the next startup prune.
   */
  readonly definition: (request: DefinitionRequest) => Promise<IpcResult<DefinitionView>>;
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

interface Workspace extends Disposable {
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
  /** Head-side changed lines per session and head: badges describe the head that was asked. */
  const spansByHead = new LruCache<string, ChangedLines>(32);

  const checkout = async (
    sessionId: string,
    repository: GitRepository,
    headSha: CommitSha,
  ): Promise<Result<Workspace, IpcError>> => {
    const lease = await worktrees.acquire(repository, {
      kind: 'session-head',
      sessionId,
      headSha,
    });
    return lease.ok
      ? ok({
          root: lease.value.path,
          repository,
          [Symbol.dispose]: (): void => {
            lease.value[Symbol.dispose]();
          },
        })
      : worktreeFailure(logger, lease.error);
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

  /**
   * A server may answer an imported name with its import in the same file (typescript-language-
   * server does while it is still loading the project). Asking again at the import, then at its
   * module specifier and looking the imported name up among that module's symbols, reaches the
   * declaration. Once per target, so a cycle can't loop.
   */
  const throughImports = async (
    root: string,
    file: string,
    text: string,
    targets: readonly LocationView[],
  ): Promise<Result<readonly LocationView[], LspError>> => {
    const lines = text.split(lineBreak);
    const followed: LocationView[] = [];
    for (const target of targets) {
      const lineText = lines[target.range.start.line] ?? '';
      const isImport =
        target.file.kind === 'workspace' && target.file.path === file && importLine.test(lineText);
      if (!isImport) {
        followed.push(target);
        continue;
      }
      const onward = await importedDeclaration(root, file, lineText, target);
      if (!onward.ok) {
        return onward;
      }
      followed.push(...(onward.value.length > 0 ? onward.value : [target]));
    }
    return ok(followed);
  };

  const importedDeclaration = async (
    root: string,
    file: string,
    lineText: string,
    target: LocationView,
  ): Promise<Result<readonly LocationView[], LspError>> => {
    const outside = (locations: readonly LocationView[]): LocationView[] =>
      locations.filter((next) => next.file.kind !== 'workspace' || next.file.path !== file);
    const again = await multiplexer.definition({ root, path: file, position: target.range.start });
    if (!again.ok || outside(again.value).length > 0) {
      return again.ok ? ok(outside(again.value)) : again;
    }
    const specifier = moduleSpecifier.exec(lineText);
    if (specifier?.index === undefined || specifier[1] === undefined) {
      return ok([]);
    }
    const quote = specifier.index + specifier[0].length - specifier[1].length - 1;
    const modules = await multiplexer.definition({
      root,
      path: file,
      position: { line: target.range.start.line, character: quote + 1 },
    });
    if (!modules.ok) {
      return modules;
    }
    const [module] = outside(modules.value);
    if (module?.file.kind !== 'workspace') {
      return ok(module === undefined ? [] : [module]);
    }
    const local = lineText.slice(target.range.start.character, target.range.end.character);
    const name = aliasedName.exec(lineText.slice(0, target.range.start.character))?.[1] ?? local;
    const symbols = await multiplexer.documentSymbols({ root, path: module.file.path });
    if (!symbols.ok) {
      return symbols;
    }
    const declared = symbols.value.find((symbol) => symbol.name === name);
    return ok([
      declared === undefined ? module : { file: module.file, range: declared.selectionRange },
    ]);
  };

  const define = async (request: DefinitionRequest): Promise<IpcResult<DefinitionView>> => {
    const commit = await resolveSheetCommit(context, request.sessionId, request.sha);
    if (!commit.ok) {
      return commit;
    }
    const { sha } = commit.value;
    const { session, repository } = commit.value.refreshed;
    const leased = await worktrees.acquire(
      repository,
      sha === session.headSha
        ? { kind: 'session-head', sessionId: session.id, headSha: sha }
        : { kind: 'pinned-commit', sessionId: session.id, commit: sha },
    );
    if (!leased.ok) {
      return worktreeFailure(logger, leased.error);
    }
    using lease = leased.value;
    const text = await readSheetSource(context, commit.value, request.path);
    if (!text.ok) {
      return text;
    }
    const line = request.line - 1;
    const lineText = text.value.split(lineBreak)[line];
    if (lineText === undefined) {
      return err({
        code: 'invalid-request',
        message: `${request.path} has no line ${String(request.line)}`,
      });
    }
    const probes = planDefinitionProbes(lineText, request.character);
    let first: { token: ProbeToken; targets: readonly LocationView[] } | undefined;
    for (const token of probes) {
      const found = await multiplexer.definition({
        root: lease.path,
        path: request.path,
        position: { line, character: token.start },
        ...(request.kind !== undefined && { kind: request.kind }),
      });
      if (!found.ok) {
        return fail(found.error);
      }
      const resolved = await throughImports(lease.path, request.path, text.value, found.value);
      if (!resolved.ok) {
        return fail(resolved.error);
      }
      const elsewhere = resolved.value.filter((target) => !isAt(target, request.path, line, token));
      if (elsewhere.length > 0) {
        return ok({
          sha,
          token: tokenView(line, token),
          targets: elsewhere.map((target) => targetViewFrom(target)),
        });
      }
      first ??= { token, targets: resolved.value };
    }
    if (first !== undefined && first.targets.length > 0) {
      return ok({
        sha,
        token: tokenView(line, first.token),
        targets: first.targets.map((target) => targetViewFrom(target)),
      });
    }
    const symbols = await multiplexer.documentSymbols({ root: lease.path, path: request.path });
    if (!symbols.ok) {
      return fail(symbols.error);
    }
    const enclosing = findEnclosingSymbol(symbols.value, line);
    return ok({
      sha,
      ...(first !== undefined && { token: tokenView(line, first.token) }),
      targets:
        enclosing === undefined
          ? []
          : [
              targetViewFrom({
                file: { kind: 'workspace', path: request.path },
                range: enclosing.selectionRange,
              }),
            ],
    });
  };

  return {
    definition: define,
    callHierarchy: async (request): Promise<IpcResult<CallHierarchyView>> => {
      const stopwatch = new Stopwatch();
      const loaded = loadSession(context, request.sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      if (loaded.value.headSha !== request.expectedHeadSha) {
        return err({
          code: 'stale-review',
          message: 'new commits arrived since this review was loaded; reload it first',
        });
      }
      const headSha = loaded.value.headSha;
      const key = `${request.sessionId}\0${headSha}`;
      const answer = (
        calls: Result<readonly CallHierarchyCallView[], IpcError>,
      ): IpcResult<CallHierarchyView> =>
        calls.ok ? ok({ headSha, direction: request.direction, calls: calls.value }) : calls;
      const cachedSpans = spansByHead.get(key);
      if (cachedSpans !== undefined && request.nodeId !== undefined) {
        return answer(await expand(request.nodeId, request.direction, cachedSpans));
      }
      const diff = await loadReviewDiff(context, request.sessionId, { headSha });
      if (!diff.ok) {
        return diff;
      }
      const { session, repository } = diff.value.refreshed;
      const spans = headSpansFrom(diff.value.files);
      spansByHead.set(key, spans);
      if (request.nodeId !== undefined) {
        return answer(await expand(request.nodeId, request.direction, spans));
      }
      const checkedOut = await checkout(session.id, repository, session.headSha);
      if (!checkedOut.ok) {
        return checkedOut;
      }
      using workspace = checkedOut.value;
      const file = relativeFrom(repository, request.path);
      const position = await locate(workspace, request, file, spans);
      if (!position.ok) {
        return position;
      }
      const roots = await multiplexer.prepareCallHierarchy({
        root: workspace.root,
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
        ? ok({
            headSha,
            direction: request.direction,
            root: nodeViewFrom(root, spans),
            calls: calls.value,
          })
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
      const checkedOut = await checkout(session.id, repository, session.headSha);
      if (!checkedOut.ok) {
        return checkedOut;
      }
      using workspace = checkedOut.value;
      const file = relativeFrom(repository, requested);
      const report = await multiplexer.getDiagnostics({ root: workspace.root, path: file });
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

const importLine = /^\s*(?:import|export\s*(?:\{|\*|type\s*\{))/u;
/** `{ original as local }`: the name before `as`, when the import renames. */
const aliasedName = /([\w$]+)\s+as\s+$/u;
const moduleSpecifier = /(?:from|import)\s*['"]([^'"]+)['"]/u;
const lineBreak = /\r\n|\n|\r/u;

/** Whether a definition is the asked-about token itself (a name the line declares). */
function isAt(target: LocationView, path: string, line: number, token: ProbeToken): boolean {
  const { start } = target.range;
  return (
    target.file.kind === 'workspace' &&
    target.file.path === path &&
    start.line === line &&
    start.character <= token.end &&
    target.range.end.character >= token.start
  );
}

function tokenView(line: number, token: ProbeToken): NonNullable<DefinitionView['token']> {
  return {
    startLine: line + 1,
    startCharacter: token.start,
    endLine: line + 1,
    endCharacter: token.end,
    text: token.text,
  };
}

function targetViewFrom(target: LocationView): DefinitionTargetView {
  return { file: { ...target.file }, ...rangeViewFrom(target.range) };
}

function rangeViewFrom(range: Range): Omit<DefinitionTargetView, 'file'> {
  return {
    startLine: range.start.line + 1,
    startCharacter: range.start.character,
    endLine: range.end.line + 1,
    endCharacter: range.end.character,
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
