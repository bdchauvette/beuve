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
  PrepareRenameRequest,
  PrepareRenameView,
  RenameFileView,
  RenamePreviewView,
  RenameRequest,
  RenameSupportRequest,
  RenameSupportView,
  RenameUnusableFileView,
  SheetRangeView,
} from '#contract/ipc-contract.ts';
import { findTreeBlob } from '#internal/git/find-tree-blob.ts';
import type { TreeBlobEntry } from '#internal/git/find-tree-blob.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { RenamedFile } from '#internal/lsp/create-lsp-multiplexer.ts';
import type { PositionEncoding } from '#internal/lsp/lsp-protocol.ts';
import { checkUraPath } from '#internal/ura/check-ura-path.ts';
import { uraSuggestionLimits } from '#internal/ura/ura-suggestion-limits.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { Session } from '#internal/session/session.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { badgeCallHierarchyNode } from '#internal/lsp/badge-call-hierarchy-node.ts';
import type { ChangedLines } from '#internal/lsp/badge-call-hierarchy-node.ts';
import type { LspMultiplexer } from '#internal/lsp/create-lsp-multiplexer.ts';
import { findEnclosingSymbol } from '#internal/lsp/find-enclosing-symbol.ts';
import type { LspError } from '#internal/lsp/lsp-error.ts';
import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { resolveWorkspaceRoot } from '#internal/lsp/resolve-workspace-root.ts';
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
  SkippedServer,
} from '#internal/lsp/lsp-model.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err, Result } from '#x/result/result.ts';

import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { readSheetSource } from '../sheets/read-sheet-source.ts';
import { resolveSheetCommit } from '../sheets/resolve-sheet-commit.ts';
import type { SheetCommit } from '../sheets/resolve-sheet-commit.ts';
import type { SessionWorktrees, WorktreeClaim } from '../worktrees/create-session-worktrees.ts';
import type { LanguageServerRegistry } from '../language-servers/create-language-server-registry.ts';
import type { RepositoryIdentity } from '../language-servers/repository-identity.ts';
import type { ShellEnvironments } from '../shell-environment/create-shell-environments.ts';
import { worktreeFailure } from '../worktrees/worktree-failure.ts';

import type { ServerBindings } from './create-server-bindings.ts';
import { ipcErrorFromLspError } from './ipc-error-from-lsp-error.ts';
import { headSpansFrom } from './head-spans-from.ts';
import { suggestionsFromTextEdits } from './suggestions-from-text-edits.ts';
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
  /**
   * Whether Suggest Rename… can run on a file (ADR 0163): at the session head only, and when a
   * server that handles it advertises `renameProvider`.
   */
  readonly renameSupport: (request: RenameSupportRequest) => Promise<IpcResult<RenameSupportView>>;
  /**
   * The token Suggest Rename… would rename and the name to offer, or the server's refusal, at
   * `expectedHeadSha` (ADR 0078), which must still be the session head.
   */
  readonly prepareRename: (
    request: PrepareRenameRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<PrepareRenameView>>;
  /**
   * The server's rename of a token to `newName`, as the note Stage would create (ADR 0163). The
   * answer is untrusted: only text edits of files the head tracks, inside the head's checkout, are
   * kept; the rest is counted. Nothing is written.
   */
  readonly rename: (
    request: RenameRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<RenamePreviewView>>;
}

/** A rename's file, found in the head's tree. */
interface TrackedFile {
  readonly file: RenamedFile;
  readonly blob: TreeBlobEntry;
}

/** What a rename's edits became, file by file. */
interface RenameOutcome {
  readonly files: readonly RenameFileView[];
  readonly untracked: number;
  readonly unusable: readonly RenameUnusableFileView[];
}

/** A server's edits to the head's files, and how to read their columns. */
interface HeadEdits {
  readonly commit: SheetCommit;
  readonly encoding: PositionEncoding;
  readonly files: readonly RenamedFile[];
}

/** The session head's line a rename asks about, read in the head's commit. */
interface RenameLine {
  readonly commit: SheetCommit;
  readonly lineText: string;
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
  /**
   * The shell environments the servers run in (ADR 0111): a restart forgets a checkout's, and a
   * note about one that fell back goes with its diagnostics.
   */
  readonly environments?: Pick<ShellEnvironments, 'forget' | 'noticeFor'>;
  /**
   * The reviewer's language server configuration (ADR 0111): each request resolves the servers
   * of its session's repository over `builtins` and binds them to the checkout it runs in; a
   * restart reads the files again; what is wrong with them shows with diagnostics.
   */
  readonly servers?: ServerConfiguration;
}

/** What {@link LspServicesOptions.servers} needs. */
export interface ServerConfiguration {
  readonly registry: LanguageServerRegistry;
  readonly bindings: Pick<ServerBindings, 'bind'>;
  /** beuve's own definitions, which the configuration is applied over. */
  readonly builtins: readonly ServerDefinition[];
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

  /** Binds the servers of the session's repository to the checkout; returns what is wrong with the files. */
  const bindServers = async (session: Session, root: string): Promise<readonly string[]> => {
    const configuration = options.servers;
    if (configuration === undefined) {
      return [];
    }
    const resolved = configuration.registry.resolve({
      builtins: configuration.builtins,
      repository: repositoryIdentityOf(session.source),
    });
    configuration.bindings.bind(await canonicalRootOf(root), resolved.definitions);
    return resolved.problems;
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
    await bindServers(session, lease.path);
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
    await bindServers(session, lease.path);
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
    const configProblems = await bindServers(session, lease.path);
    const report = await multiplexer.getDiagnostics({ root: lease.path, path: request.path });
    if (!report.ok) {
      if (report.error.kind === 'server-not-found') {
        return ok({
          sha,
          state: 'unavailable',
          diagnostics: [],
          omitted: 0,
          notice: [notInstalledNotice(report.error), ...configProblems].join(' '),
        });
      }
      if (report.error.kind === 'server-untrusted') {
        return ok({
          sha,
          state: 'untrusted',
          diagnostics: [],
          omitted: 0,
          notice: [report.error.reason, ...configProblems].join(' '),
        });
      }
      if (isUndiagnosable(report.error)) {
        return ok({ sha, state: 'unavailable', diagnostics: [], omitted: 0 });
      }
      return fail(report.error);
    }
    const items = report.value.diagnostics.map((diagnostic) => {
      return diagnosticItemFrom(diagnostic);
    });
    const notices = [...skippedNoticesFrom(report.value.skipped), ...configProblems];
    const environmentNotice = options.environments?.noticeFor(await canonicalRootOf(lease.path));
    if (environmentNotice !== undefined) {
      notices.push(environmentNotice);
    }
    return ok({
      sha,
      state: stateOf(report.value.freshness),
      diagnostics: items.slice(0, maxDiagnosticsPerFile),
      omitted: Math.max(0, items.length - maxDiagnosticsPerFile),
      ...(notices.length > 0 && { notice: notices.join(' ') }),
    });
  };

  /** The head's commit and the asked line, once `expectedHeadSha` is known to still be the head. */
  const renameLine = async (
    request: PrepareRenameRequest,
    options: RequestOptions,
  ): Promise<Result<RenameLine, IpcError>> => {
    const commit = await resolveSheetCommit(context, { sessionId: request.sessionId }, options);
    if (!commit.ok) {
      return commit;
    }
    if (commit.value.sha !== request.expectedHeadSha) {
      return err({
        code: 'stale-review',
        message: 'new commits arrived since this review was loaded; reload it first',
      });
    }
    const text = await readSheetSource(context, commit.value, request.path);
    if (!text.ok) {
      return text;
    }
    const lineText = text.value.split(lineBreak)[request.line - 1];
    if (lineText === undefined) {
      return err({
        code: 'invalid-request',
        message: `${request.path} has no line ${String(request.line)}`,
      });
    }
    return ok({ commit: commit.value, lineText });
  };

  /** A rename request's failure: a refusal the reviewer reads in place, a timeout, or the error. */
  const renameFailure = (error: LspError, deadline: Deadline): Err<IpcError> => {
    if (error.kind === 'request-cancelled' && deadline.hasTimedOut()) {
      return err({
        code: 'lsp-failed',
        message: `The language server did not answer within ${String(renameDeadline.seconds)} seconds.`,
      });
    }
    if (error.kind === 'request-cancelled') {
      return err({ code: 'cancelled', message: 'cancelled' });
    }
    if (error.kind === 'request-failed') {
      return err({ code: 'refused', message: serverMessageFrom(error.message) });
    }
    if (isUnhoverable(error)) {
      return err({
        code: 'unsupported',
        message: 'No language server that handles this file can rename.',
      });
    }
    return fail(error);
  };

  const prepareRename = async (
    request: PrepareRenameRequest,
    options: RequestOptions = {},
  ): Promise<IpcResult<PrepareRenameView>> => {
    const asked = await renameLine(request, options);
    if (!asked.ok) {
      return asked;
    }
    const { commit, lineText } = asked.value;
    const { sha } = commit;
    const { session, repository } = commit.refreshed;
    const leased = await worktrees.acquire(repository, claimOf(session, sha), {
      signal: options.signal,
    });
    if (!leased.ok) {
      return worktreeFailure(logger, leased.error);
    }
    using lease = leased.value;
    await bindServers(session, lease.path);
    const deadline = deadlineFrom(options.signal);
    const line = request.line - 1;
    const prepared = await multiplexer.prepareRename({
      root: lease.path,
      path: request.path,
      position: { line, character: request.character },
      signal: deadline.signal,
    });
    if (!prepared.ok) {
      const failure = renameFailure(prepared.error, deadline);
      if (failure.error.code === 'refused' || failure.error.code === 'unsupported') {
        return ok({ kind: 'refused', headSha: sha, message: failure.error.message });
      }
      return failure;
    }
    const answer = prepared.value;
    if (answer.kind === 'refused') {
      return ok({
        kind: 'refused',
        headSha: sha,
        message: 'The language server can’t rename this.',
      });
    }
    const word = wordAt(lineText, request.character);
    if (answer.kind === 'default') {
      if (word === undefined) {
        return ok({ kind: 'refused', headSha: sha, message: 'There is no name to rename here.' });
      }
      return ok({
        kind: 'ready',
        headSha: sha,
        range: {
          startLine: request.line,
          startCharacter: word.start,
          endLine: request.line,
          endCharacter: word.end,
        },
        placeholder: word.text,
      });
    }
    const { range } = answer;
    let placeholder = answer.placeholder;
    if (placeholder === undefined && range.start.line === line && range.end.line === line) {
      placeholder = lineText.slice(range.start.character, range.end.character);
    }
    return ok({
      kind: 'ready',
      headSha: sha,
      range: sheetRangeFrom(range),
      placeholder: placeholder ?? word?.text ?? '',
    });
  };

  /** Each file the head tracks as suggestions; untracked and unusable ones counted. */
  const suggestionsOf = async ({
    commit,
    encoding,
    files,
  }: HeadEdits): Promise<Result<RenameOutcome, IpcError>> => {
    const { repository } = commit.refreshed;
    const tracked: TrackedFile[] = [];
    const unusable: RenameUnusableFileView[] = [];
    let untracked = 0;
    for (const file of files) {
      const pathReason = checkUraPath(file.path);
      if (pathReason !== undefined) {
        unusable.push({ path: file.path, reason: pathReason });
        continue;
      }
      const blob = await findTreeBlob(repository, commit.sha, file.path);
      if (!blob.ok) {
        return gitFailure(logger, blob.error);
      }
      if (blob.value === undefined) {
        untracked += 1;
        continue;
      }
      tracked.push({ file, blob: blob.value });
    }
    const blobs = await readBlobs(
      repository,
      tracked.map(({ blob }) => blob),
    );
    if (!blobs.ok) {
      return gitFailure(logger, blobs.error);
    }
    const suggested: RenameFileView[] = [];
    for (const { file, blob } of tracked) {
      const content = blobs.value.get(blob.objectId);
      if (content?.kind !== 'text') {
        unusable.push({ path: file.path, reason: 'it is not a text file beuve can read' });
        continue;
      }
      const suggestions = suggestionsFromTextEdits({
        path: file.path,
        text: content.text,
        edits: file.edits,
        encoding,
      });
      if (!suggestions.ok) {
        unusable.push({ path: file.path, reason: suggestions.error });
        continue;
      }
      const isTooLarge = suggestions.value.some((suggestion) => {
        return utf8Length(suggestion.replacement) > uraSuggestionLimits.maxReplacementBytes;
      });
      if (isTooLarge) {
        unusable.push({ path: file.path, reason: 'a change is too large for a suggestion' });
        continue;
      }
      if (suggestions.value.length > 0) {
        suggested.push({ path: file.path, suggestions: suggestions.value });
      }
    }
    return ok({ files: suggested, untracked, unusable });
  };

  const rename = async (
    request: RenameRequest,
    options: RequestOptions = {},
  ): Promise<IpcResult<RenamePreviewView>> => {
    const asked = await renameLine(request, options);
    if (!asked.ok) {
      return asked;
    }
    const { commit, lineText } = asked.value;
    const oldName = wordAt(lineText, request.character)?.text ?? '';
    if (request.newName === oldName) {
      return err({ code: 'invalid-request', message: `It is already called ${oldName}.` });
    }
    const { sha } = commit;
    const { session, repository } = commit.refreshed;
    const leased = await worktrees.acquire(repository, claimOf(session, sha), {
      signal: options.signal,
    });
    if (!leased.ok) {
      return worktreeFailure(logger, leased.error);
    }
    using lease = leased.value;
    await bindServers(session, lease.path);
    const deadline = deadlineFrom(options.signal);
    const renamed = await multiplexer.rename({
      root: lease.path,
      path: request.path,
      position: { line: request.line - 1, character: request.character },
      newName: request.newName,
      signal: deadline.signal,
    });
    if (!renamed.ok) {
      return renameFailure(renamed.error, deadline);
    }
    const outcome = await suggestionsOf({
      commit,
      encoding: renamed.value.encoding,
      files: renamed.value.files,
    });
    if (!outcome.ok) {
      return outcome;
    }
    const total = outcome.value.files.reduce((sum, file) => {
      return sum + file.suggestions.length;
    }, 0);
    if (total > uraSuggestionLimits.maxSuggestions) {
      return err({
        code: 'refused',
        message: `This rename changes ${String(total)} places, and a note holds at most ${String(uraSuggestionLimits.maxSuggestions)} suggestions. Rename it in an editor on the review edits branch (Review ▸ Review Edits) instead.`,
      });
    }
    return ok({
      headSha: sha,
      path: request.path,
      line: request.line,
      oldName,
      newName: request.newName,
      title: renameTitleFrom({ oldName, newName: request.newName }),
      files: outcome.value.files,
      leftOut: {
        resourceOperations: renamed.value.resourceOperations,
        outsideCheckout: renamed.value.outside,
        untracked: outcome.value.untracked,
        malformed: renamed.value.malformed,
        unusable: outcome.value.unusable,
      },
    });
  };

  const renameSupport = async (
    request: RenameSupportRequest,
  ): Promise<IpcResult<RenameSupportView>> => {
    const commit = await resolveSheetCommit(context, request);
    if (!commit.ok) {
      return commit;
    }
    const { sha } = commit.value;
    const { session, repository } = commit.value.refreshed;
    if (sha !== session.headSha) {
      return ok({ sha, supported: false });
    }
    const leased = await worktrees.acquire(repository, claimOf(session, sha));
    if (!leased.ok) {
      return worktreeFailure(logger, leased.error);
    }
    using lease = leased.value;
    await bindServers(session, lease.path);
    const supported = await multiplexer.renameSupport({ root: lease.path, path: request.path });
    if (supported.ok) {
      return ok({ sha, supported: supported.value });
    }
    if (isUndiagnosable(supported.error) || supported.error.kind === 'server-not-found') {
      return ok({ sha, supported: false });
    }
    return fail(supported.error);
  };

  return {
    definition: define,
    hover,
    diagnostics,
    renameSupport,
    prepareRename,
    rename,
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
      options.environments?.forget(await canonicalRootOf(workspace.root));
      await options.servers?.registry.reload();
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
      await bindServers(session, workspace.root);
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

/** How long a server has to answer `prepareRename` or `rename` (ADR 0163). */
const renameDeadline = Temporal.Duration.from({ seconds: 10 });
/** typescript-language-server's wrapping of tsserver's own words. */
const requestFailedPrefix = /^Request \S+ failed with message: /u;
/** How much of a server's refusal reaches the reviewer. */
const maxServerMessageLength = 300;
/** Longest name a rename's title quotes in full. */
const maxTitleNameLength = 80;

/** The caller's signal joined with the rename deadline, which says when it was the deadline. */
interface Deadline {
  readonly signal: AbortSignal;
  readonly hasTimedOut: () => boolean;
}

/** The names a rename goes from and to. */
interface RenameNames {
  readonly oldName: string;
  readonly newName: string;
}

/** A name in a line of code: where it starts and ends (UTF-16), and its text. */
interface LineWord {
  readonly start: number;
  readonly end: number;
  readonly text: string;
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
  return planDefinitionProbes(lineText, { character, link: request.link === true });
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

/** What an override's `match` is tried against: the reviewer's clone, and a pull request's remote. */
function repositoryIdentityOf(source: Session['source']): RepositoryIdentity {
  if (source.kind === 'github-pull-request') {
    return {
      clonePath: source.repoPath,
      remote: `${source.host}/${source.owner}/${source.repo}`.toLowerCase(),
    };
  }
  return { clonePath: source.repoPath };
}

/** The real path the multiplexer keys a checkout by, which the shell environments use too. */
async function canonicalRootOf(root: string): Promise<string> {
  const resolved = await resolveWorkspaceRoot(root);
  if (resolved.ok) {
    return resolved.value;
  }
  return root;
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

/**
 * What the reviewer can act on among the servers that handle the file but gave nothing: one the
 * trust check refused, and one that is not installed. Others (crashes, timeouts) are in the log.
 */
function skippedNoticesFrom(skipped: readonly SkippedServer[]): string[] {
  const notices: string[] = [];
  for (const { error } of skipped) {
    if (error.kind === 'server-untrusted') {
      notices.push(error.reason);
    } else if (error.kind === 'server-not-found') {
      notices.push(notInstalledNotice(error));
    }
  }
  return notices;
}

/** A language server's program was not found: what to do about it. */
function notInstalledNotice(error: Extract<LspError, { kind: 'server-not-found' }>): string {
  return `The ${error.serverId} language server is not installed: ${error.command} was not found. Install it, then restart the language servers (Review menu).`;
}

function diagnosticItemFrom(diagnostic: DiagnosticView): DiagnosticItemView {
  return {
    ...sheetRangeFrom(diagnostic.range),
    severity: diagnostic.severity ?? 'error',
    message: diagnostic.message.slice(0, maxMessageLength),
    ...(diagnostic.code !== undefined && { code: diagnostic.code }),
    ...(diagnostic.source !== undefined && { source: diagnostic.source }),
    serverId: diagnostic.serverId,
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

function deadlineFrom(signal: AbortSignal | undefined): Deadline {
  const timeout = timeoutSignal(renameDeadline);
  let combined = timeout;
  if (signal !== undefined) {
    combined = AbortSignal.any([signal, timeout]);
  }
  return {
    signal: combined,
    hasTimedOut: (): boolean => {
      return combined.aborted && combined.reason === timeout.reason;
    },
  };
}

/** The identifier around a UTF-16 column, as the token a rename is about when the server says nothing. */
function wordAt(lineText: string, character: number): LineWord | undefined {
  for (const match of lineText.matchAll(/[\p{L}\p{N}_$]+/gu)) {
    const end = match.index + match[0].length;
    if (match.index <= character && character <= end) {
      return { start: match.index, end, text: match[0] };
    }
  }
  return undefined;
}

/** "Rename `old` to `new`" (ADR 0163), a long name cut so the title stays one short line. */
function renameTitleFrom({ oldName, newName }: RenameNames): string {
  return `Rename \`${shortNameOf(oldName)}\` to \`${shortNameOf(newName)}\``;
}

function shortNameOf(name: string): string {
  if (name.length <= maxTitleNameLength) {
    return name;
  }
  return `${name.slice(0, maxTitleNameLength - 1)}…`;
}

/** A server's own words for a refusal, on one line and cut short. */
function serverMessageFrom(message: string): string {
  const line = message.replaceAll(/\s+/gu, ' ').replace(requestFailedPrefix, '').trim();
  if (line === '') {
    return 'The language server can’t rename this.';
  }
  if (line.length <= maxServerMessageLength) {
    return line;
  }
  return `${line.slice(0, maxServerMessageLength - 1)}…`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
