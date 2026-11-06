import path from 'node:path';

import type {
  CallHierarchyCallView,
  CallHierarchyNodeView,
  CallHierarchyRequest,
  CallHierarchyView,
  DefinitionRequest,
  DefinitionTargetView,
  DefinitionView,
  DiagnosticItemView,
  DiagnosticsRequest,
  DiagnosticsView,
  HoverRequest,
  HoverView,
  IpcError,
  IpcResult,
  LspRestartedView,
  LspRestartRequest,
  LspStatusView,
  SheetRangeView,
} from '#contract/ipc-contract.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { Session } from '#internal/session/session.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { badgeCallHierarchyNode } from '#internal/lsp/badge-call-hierarchy-node.ts';
import type { ChangedLines } from '#internal/lsp/badge-call-hierarchy-node.ts';
import type { LspMultiplexer } from '#internal/lsp/create-lsp-multiplexer.ts';
import { findEnclosingSymbol } from '#internal/lsp/find-enclosing-symbol.ts';
import type { LspError } from '#internal/lsp/lsp-error.ts';
import { findModuleSpecifier } from '#internal/lsp/find-module-specifier.ts';
import { planDefinitionProbes } from '#internal/lsp/plan-definition-probes.ts';
import type { ProbeToken } from '#internal/lsp/plan-definition-probes.ts';
import type {
  CallHierarchyCall,
  CallHierarchyNode,
  DiagnosticsFreshness,
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
import type { SessionWorktrees, WorktreeClaim } from '../worktrees/create-session-worktrees.ts';
import { worktreeFailure } from '../worktrees/worktree-failure.ts';

import { ipcErrorFromLspError } from './ipc-error-from-lsp-error.ts';
import { headSpansFrom } from './head-spans-from.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

/** Language-server features over a checkout of the session head (ADR 0020). */
export interface LspServices {
  readonly callHierarchy: (request: CallHierarchyRequest) => Promise<IpcResult<CallHierarchyView>>;
  /**
   * Where the symbol on a line is defined (ADR 0067), in a checkout of the requested commit: the
   * session head's own (ADR 0020), or, for a sheet pinned to an older commit, a checkout of that
   * commit kept until the next startup prune.
   */
  readonly definition: (request: DefinitionRequest) => Promise<IpcResult<DefinitionView>>;
  /**
   * What the language server says about the token at a position, in the same checkouts as
   * {@link LspServices.definition}. A file no server handles, or a server without hover support,
   * answers "nothing to say", not an error: a pointer rests on all kinds of files.
   */
  readonly hover: (request: HoverRequest) => Promise<IpcResult<HoverView>>;
  /**
   * What the language servers report about a file of the session head (ADR 0111), once they have
   * settled or the deadline passed. Any other commit answers `not-head`; a file no server handles
   * answers `unavailable`. Both are answers, not errors: the renderer asks about every file it shows.
   */
  readonly diagnostics: (request: DiagnosticsRequest) => Promise<IpcResult<DiagnosticsView>>;
  /**
   * Stops the language servers of the session head's checkout, so the next request starts them
   * afresh: after the reviewer installed dependencies there, or when a server misbehaves.
   */
  readonly restart: (request: LspRestartRequest) => Promise<IpcResult<LspRestartedView>>;
  /** The language servers beuve has started and their state, for the status bar. */
  readonly status: () => IpcResult<LspStatusView>;
}

/** A head file being asked about, in the checkout that answers. */
interface WorkspaceFile {
  readonly workspace: Workspace;
  readonly file: string;
  readonly spans: ChangedLines;
}

/** A file's text, read in the checkout whose server answers about it. */
interface CheckedOutText {
  readonly root: string;
  readonly file: string;
  readonly text: string;
}

/** One line of a checked-out file that imports a name. */
interface ImportingLine {
  readonly root: string;
  readonly file: string;
  readonly lineText: string;
}

/** The token a definition request asked about, on 0-based `line` of `path`. */
interface AskedToken {
  readonly path: string;
  readonly line: number;
  readonly token: ProbeToken;
}

/** 0-based lines, both ends included. */
interface LineInterval {
  readonly from: number;
  readonly to: number;
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
    if (lease.ok) {
      return ok({
        root: lease.value.path,
        repository,
        [Symbol.dispose]: (): void => {
          lease.value[Symbol.dispose]();
        },
      });
    }
    return worktreeFailure(logger, lease.error);
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
    let calls: Result<readonly CallHierarchyCall[], LspError>;
    if (direction === 'incoming') {
      calls = await multiplexer.incomingCalls(nodeId);
    } else {
      calls = await multiplexer.outgoingCalls(nodeId);
    }
    if (calls.ok) {
      return ok(calls.value.map((call) => callViewFrom(call, spans)));
    }
    return fail(calls.error);
  };

  const locate = async (
    request: CallHierarchyRequest,
    { workspace, file, spans }: WorkspaceFile,
  ): Promise<Result<Position, IpcError>> => {
    const line = request.line - 1;
    if (request.character !== undefined) {
      return ok({ line, character: request.character });
    }
    const symbols = await multiplexer.documentSymbols({ root: workspace.root, path: file });
    if (!symbols.ok) {
      return fail(symbols.error);
    }
    const span = spans.get(file)?.find((candidate) => {
      return candidate.startLine <= request.line && candidate.endLine >= request.line;
    });
    let symbol = findEnclosingSymbol(symbols.value, line);
    if (symbol === undefined && span !== undefined) {
      symbol = findFirstCallable(symbols.value, { from: line, to: span.endLine - 1 });
    }
    if (symbol === undefined) {
      return err({
        code: 'not-found',
        message: `no function, method or constructor encloses line ${String(request.line)} of ${file}`,
      });
    }
    return ok(symbol.selectionRange.start);
  };

  /**
   * A server may answer an imported name with its import in the same file (typescript-language-
   * server does while it is still loading the project). Asking again at the import, then at its
   * module specifier and looking the imported name up among that module's symbols, reaches the
   * declaration. Once per target, so a cycle can't loop.
   */
  const throughImports = async (
    { root, file, text }: CheckedOutText,
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
      const onward = await importedDeclaration({ root, file, lineText }, target);
      if (!onward.ok) {
        return onward;
      }
      if (onward.value.length > 0) {
        followed.push(...onward.value);
      } else {
        followed.push(target);
      }
    }
    return ok(followed);
  };

  const importedDeclaration = async (
    { root, file, lineText }: ImportingLine,
    target: LocationView,
  ): Promise<Result<readonly LocationView[], LspError>> => {
    const outside = (locations: readonly LocationView[]): LocationView[] => {
      return locations.filter((next) => next.file.kind !== 'workspace' || next.file.path !== file);
    };
    const again = await multiplexer.definition({ root, path: file, position: target.range.start });
    if (!again.ok || outside(again.value).length > 0) {
      if (again.ok) {
        return ok(outside(again.value));
      }
      return again;
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
    if (module === undefined) {
      return ok([]);
    }
    if (module.file.kind !== 'workspace') {
      return ok([module]);
    }
    const local = lineText.slice(target.range.start.character, target.range.end.character);
    const name = aliasedName.exec(lineText.slice(0, target.range.start.character))?.[1] ?? local;
    const symbols = await multiplexer.documentSymbols({ root, path: module.file.path });
    if (!symbols.ok) {
      return symbols;
    }
    const declared = symbols.value.find((symbol) => symbol.name === name);
    if (declared === undefined) {
      return ok([module]);
    }
    return ok([{ file: module.file, range: declared.selectionRange }]);
  };

  const define = async (request: DefinitionRequest): Promise<IpcResult<DefinitionView>> => {
    const commit = await resolveSheetCommit(context, request);
    if (!commit.ok) {
      return commit;
    }
    const { sha } = commit.value;
    const { session, repository } = commit.value.refreshed;
    const leased = await worktrees.acquire(repository, claimOf(session, sha));
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
    const probes = probesFor(lineText, request);
    if (request.link === true && probes.length === 0) {
      return ok({ sha, targets: [] });
    }
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
      const resolved = await throughImports(
        { root: lease.path, file: request.path, text: text.value },
        found.value,
      );
      if (!resolved.ok) {
        return fail(resolved.error);
      }
      const elsewhere = resolved.value.filter((target) => {
        return !isAt(target, { path: request.path, line, token });
      });
      if (elsewhere.length > 0 || request.link === true) {
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
    const targets: DefinitionTargetView[] = [];
    if (enclosing !== undefined) {
      targets.push(
        targetViewFrom({
          file: { kind: 'workspace', path: request.path },
          range: enclosing.selectionRange,
        }),
      );
    }
    return ok({
      sha,
      ...(first !== undefined && { token: tokenView(line, first.token) }),
      targets,
    });
  };

  const hover = async (request: HoverRequest): Promise<IpcResult<HoverView>> => {
    const commit = await resolveSheetCommit(context, request);
    if (!commit.ok) {
      return commit;
    }
    const { sha } = commit.value;
    const { session, repository } = commit.value.refreshed;
    const leased = await worktrees.acquire(repository, claimOf(session, sha));
    if (!leased.ok) {
      return worktreeFailure(logger, leased.error);
    }
    using lease = leased.value;
    const text = await readSheetSource(context, commit.value, request.path);
    if (!text.ok) {
      return text;
    }
    const line = request.line - 1;
    if (text.value.split(lineBreak)[line] === undefined) {
      return err({
        code: 'invalid-request',
        message: `${request.path} has no line ${String(request.line)}`,
      });
    }
    const found = await multiplexer.hover({
      root: lease.path,
      path: request.path,
      position: { line, character: request.character },
    });
    if (!found.ok) {
      if (isUnhoverable(found.error)) {
        return ok({ sha });
      }
      return fail(found.error);
    }
    if (found.value === undefined) {
      return ok({ sha });
    }
    const { markdown, range } = found.value;
    if (range === undefined) {
      return ok({ sha, hover: { markdown } });
    }
    return ok({ sha, hover: { markdown, range: sheetRangeFrom(range) } });
  };

  const diagnostics = async (request: DiagnosticsRequest): Promise<IpcResult<DiagnosticsView>> => {
    const commit = await resolveSheetCommit(context, request);
    if (!commit.ok) {
      return commit;
    }
    const { sha } = commit.value;
    const { session, repository } = commit.value.refreshed;
    if (sha !== session.headSha) {
      return ok({ sha, state: 'not-head', diagnostics: [], omitted: 0 });
    }
    const leased = await worktrees.acquire(repository, claimOf(session, sha));
    if (!leased.ok) {
      return worktreeFailure(logger, leased.error);
    }
    using lease = leased.value;
    const report = await multiplexer.getDiagnostics({ root: lease.path, path: request.path });
    if (!report.ok) {
      if (isUndiagnosable(report.error)) {
        return ok({ sha, state: 'unavailable', diagnostics: [], omitted: 0 });
      }
      return fail(report.error);
    }
    const items = report.value.diagnostics.map((diagnostic) => {
      return diagnosticItemFrom(diagnostic, report.value.serverId);
    });
    return ok({
      sha,
      state: stateOf(report.value.freshness),
      diagnostics: items.slice(0, maxDiagnosticsPerFile),
      omitted: Math.max(0, items.length - maxDiagnosticsPerFile),
    });
  };

  return {
    definition: define,
    hover,
    diagnostics,
    status: (): IpcResult<LspStatusView> => {
      return ok({
        servers: multiplexer.status().map(({ serverId, root, state, openDocuments, restarts }) => {
          return { serverId, root, state, openDocuments, restarts };
        }),
      });
    },
    restart: async ({ sessionId }): Promise<IpcResult<LspRestartedView>> => {
      const loaded = loadSession(context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const refreshed = await refreshSession(context, loaded.value);
      if (!refreshed.ok) {
        return refreshed;
      }
      const { session, repository } = refreshed.value;
      const leased = await checkout(session.id, repository, session.headSha);
      if (!leased.ok) {
        return leased;
      }
      using workspace = leased.value;
      await multiplexer.restart(workspace.root);
      return ok({ sessionId: session.id, headSha: session.headSha });
    },
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
      ): IpcResult<CallHierarchyView> => {
        if (calls.ok) {
          return ok({ headSha, direction: request.direction, calls: calls.value });
        }
        return calls;
      };
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
      const position = await locate(request, { workspace, file, spans });
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
      if (calls.ok) {
        return ok({
          headSha,
          direction: request.direction,
          root: nodeViewFrom(root, spans),
          calls: calls.value,
        });
      }
      return calls;
    },
  };
}

const importLine = /^\s*(?:import|export\s*(?:\{|\*|type\s*\{))/u;
/** `{ original as local }`: the name before `as`, when the import renames. */
const aliasedName = /([\w$]+)\s+as\s+$/u;
const moduleSpecifier = /(?:from|import)\s*['"]([^'"]+)['"]/u;
const lineBreak = /\r\n|\n|\r/u;

/** The checkout a definition at `sha` reads: the session head's own, else one pinned to `sha`. */
function claimOf(session: Session, sha: CommitSha): WorktreeClaim {
  if (sha === session.headSha) {
    return { kind: 'session-head', sessionId: session.id, headSha: sha };
  }
  return { kind: 'pinned-commit', sessionId: session.id, commit: sha };
}

/** Whether a definition is the asked-about token itself (a name the line declares). */
function isAt(target: LocationView, { path, line, token }: AskedToken): boolean {
  const { start } = target.range;
  return (
    target.file.kind === 'workspace' &&
    target.file.path === path &&
    start.line === line &&
    start.character <= token.end &&
    target.range.end.character >= token.start
  );
}

/** A module specifier under the pointer is the token (its file is the definition); else the line's identifiers. */
function probesFor(lineText: string, request: DefinitionRequest): readonly ProbeToken[] {
  const { character } = request;
  if (character !== undefined) {
    const specifier = findModuleSpecifier(lineText, character);
    if (specifier !== undefined) {
      return [specifier];
    }
  }
  return planDefinitionProbes(lineText, character, { link: request.link === true });
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
  return { file: { ...target.file }, ...sheetRangeFrom(target.range) };
}

/** How many diagnostics of one file reach the renderer. */
const maxDiagnosticsPerFile = 500;
/** A diagnostic's message is cut here, so one server cannot send the renderer a book. */
const maxMessageLength = 4096;

/** Failures that only mean no server can give diagnostics for this file. */
function isUndiagnosable(error: LspError): boolean {
  return isUnhoverable(error) || error.kind === 'invalid-path';
}

function stateOf(freshness: DiagnosticsFreshness): DiagnosticsView['state'] {
  if (freshness === 'timed-out') {
    return 'timed-out';
  }
  return 'settled';
}

function diagnosticItemFrom(diagnostic: DiagnosticView, serverId: string): DiagnosticItemView {
  return {
    ...sheetRangeFrom(diagnostic.range),
    severity: diagnostic.severity ?? 'error',
    message: diagnostic.message.slice(0, maxMessageLength),
    ...(diagnostic.code !== undefined && { code: diagnostic.code }),
    ...(diagnostic.source !== undefined && { source: diagnostic.source }),
    serverId,
  };
}

/** Failures that only mean no server can hover over this file. */
function isUnhoverable(error: LspError): boolean {
  return (
    error.kind === 'unsupported-language' ||
    error.kind === 'capability-missing' ||
    error.kind === 'file-too-large'
  );
}

function sheetRangeFrom(range: Range): SheetRangeView {
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
  { from, to }: LineInterval,
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
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return requested;
  }
  return relative;
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
