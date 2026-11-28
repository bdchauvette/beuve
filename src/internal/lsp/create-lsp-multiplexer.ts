import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { constants } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LruCache } from '#x/collections/lru-cache.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Err, Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import { convertCharacter } from './convert-character.ts';
import { checkServerTrust } from './check-server-trust.ts';
import type { ServerTrustDecision, ServerTrustRequest } from './check-server-trust.ts';
import { createServerEnvironment } from './create-server-environment.ts';
import { createViewMapper } from './create-view-mapper.ts';
import type { ViewMapper } from './create-view-mapper.ts';
import { findServerCommand } from './find-server-command.ts';
import { findServerRoot } from './find-server-root.ts';
import { resolveProjectCommand } from './resolve-project-command.ts';
import { isWithinDirectory } from './is-within-directory.ts';
import { LineIndex } from './line-index.ts';
import type { LspError } from './lsp-error.ts';
import type {
  CallHierarchyCall,
  CallHierarchyNode,
  DiagnosticsFreshness,
  DiagnosticsReport,
  DiagnosticView,
  DocumentSymbolView,
  HoverView,
  LocationView,
  Position,
  Range,
  ServerStatus,
  SkippedServer,
} from './lsp-model.ts';
import type { LspCallHierarchyItem, LspTextEdit, PositionEncoding } from './lsp-protocol.ts';
import { normalizeUri } from './normalize-uri.ts';
import { parseCallHierarchyItems } from './parse-call-hierarchy-items.ts';
import type { LspCallHierarchyEdge } from './parse-call-hierarchy-items.ts';
import { parseDocumentSymbols } from './parse-document-symbols.ts';
import { parseHover } from './parse-hover.ts';
import { parseLocations } from './parse-locations.ts';
import { parsePrepareRename } from './parse-prepare-rename.ts';
import { parseWorkspaceEdit } from './parse-workspace-edit.ts';
import { resolveWorkspaceFile } from './resolve-workspace-file.ts';
import type { WorkspaceFile } from './resolve-workspace-file.ts';
import { resolveWorkspaceRoot } from './resolve-workspace-root.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import type { ServerDefinition } from './server-definition.ts';
import { ServerSession } from './server-session.ts';
import type { DocumentContent, FileStamp, SyncedDocument } from './server-session.ts';
import type { ServerExit } from './start-language-server.ts';
import { startLanguageServer } from './start-language-server.ts';
import { typescriptServerDefinition } from './typescript-server-definition.ts';
import { positionEncodings } from './position-encodings.ts';

export interface LspMultiplexerOptions {
  /** The server registry. Defaults to `[typescriptServerDefinition()]`. */
  readonly servers?: readonly ServerDefinition[];
  /** Directories searched for bare server commands before `PATH`, e.g. beuve's `node_modules/.bin`. */
  readonly searchDirectories?: readonly string[];
  /**
   * Also search `<root>/node_modules/.bin`, first. Off by default: a reviewed branch can commit
   * an executable there, and running it would execute the code under review.
   */
  readonly trustWorkspaceBinaries?: boolean;
  /** Source of the inherited allow-listed variables (`createServerEnvironment`). Defaults to `process.env`. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /**
   * The environment the servers of one checkout run in and find their programs through, such as
   * the one the reviewer's login shell gives there (ADR 0111). Asked each time a server starts;
   * the caller caches. When absent, every server gets `environment`.
   */
  readonly environmentFor?: (root: string) => Promise<Readonly<Record<string, string | undefined>>>;
  /**
   * Decides whether a server may start in a checkout (ADR 0111). A refusal is an
   * `server-untrusted` error and starts nothing. Defaults to {@link checkServerTrust}.
   */
  readonly trust?: (request: ServerTrustRequest) => ServerTrustDecision;
  /**
   * The servers for the checkout `workspace` (real path), when they differ from `servers`: the
   * reviewer's configuration applies per repository (ADR 0111), and main knows which repository a
   * checkout is of. Asked on every request, so it must be cheap.
   */
  readonly serversFor?: (workspace: string) => readonly ServerDefinition[] | undefined;
  readonly logger?: Logger;
  /** Per request. Defaults to 15 s. */
  readonly requestTimeout?: Temporal.Duration;
  /** Default upper bound for `getDiagnostics`. Defaults to 20 s. */
  readonly diagnosticsTimeout?: Temporal.Duration;
  /** How long to wait for a new report after a change when the old one stands. Defaults to 1.5 s. */
  readonly diagnosticsGrace?: Temporal.Duration;
  /** Stop a server after this long without use; 0 never does. Defaults to 5 minutes. */
  readonly idleTimeout?: Temporal.Duration;
  /** Unexpected exits tolerated per window before giving up. Defaults to 3 per 5 minutes. */
  readonly maxRestarts?: number;
  readonly restartWindow?: Temporal.Duration;
  readonly maxOpenDocuments?: number;
  /** Larger files are refused. Defaults to 8 MiB. */
  readonly maxFileBytes?: number;
  /** Call hierarchy nodes remembered for expansion. Defaults to 10 000. */
  readonly maxNodes?: number;
}

export interface FileRequest {
  /** Untrusted workspace root (absolute); resolved to its real path. */
  readonly root: string;
  /** Untrusted file path, relative to `root` or absolute; must stay inside it. */
  readonly path: string;
}

export interface PositionRequest extends FileRequest {
  /** 0-based line, UTF-16 column. */
  readonly position: Position;
}

export interface DiagnosticsRequest extends FileRequest {
  /** Overrides `diagnosticsTimeout`. */
  readonly timeout?: Temporal.Duration;
}

/** A rename request (ADR 0163): read-only, so the caller's signal is all that bounds it. */
export interface PrepareRenameRequest extends PositionRequest {
  readonly signal?: AbortSignal | undefined;
}

export interface RenameRequest extends PrepareRenameRequest {
  readonly newName: string;
}

/**
 * What `prepareRename` says about a position: the token's range (UTF-16) and the name to offer,
 * `default` when the server has no `prepareProvider` or leaves finding the token to the client,
 * or `refused`.
 */
export type PrepareRenameAnswer =
  | { readonly kind: 'range'; readonly range: Range; readonly placeholder: string | undefined }
  | { readonly kind: 'default' }
  | { readonly kind: 'refused' };

/** One checkout file a rename edits, by its real path relative to the checkout. */
export interface RenamedFile {
  readonly path: string;
  /** In the server's `encoding`, unapplied and in the server's order. */
  readonly edits: readonly LspTextEdit[];
}

/**
 * A rename's `WorkspaceEdit` (ADR 0163), its files resolved inside the checkout. Untrusted
 * still: edits may overlap or point past the file, and the checkout may hold untracked files.
 */
export interface RenameAnswer {
  readonly encoding: PositionEncoding;
  /** Sorted by path. */
  readonly files: readonly RenamedFile[];
  /** Documents whose URI doesn't resolve, after symlinks, to a file inside the checkout. */
  readonly outside: number;
  readonly resourceOperations: number;
  readonly malformed: number;
}

export interface DefinitionRequest extends PositionRequest {
  /** `definition` (the default) or `type-definition`. */
  readonly kind?: 'definition' | 'type-definition';
}

/**
 * Read-only access to language servers, one process per (workspace root, server), started on
 * first use. Every method resolves to a `Result`; none rejects.
 */
export interface LspMultiplexer {
  readonly getDiagnostics: (
    request: DiagnosticsRequest,
  ) => Promise<Result<DiagnosticsReport, LspError>>;
  readonly prepareCallHierarchy: (
    request: PositionRequest,
  ) => Promise<Result<readonly CallHierarchyNode[], LspError>>;
  readonly incomingCalls: (
    nodeId: string,
  ) => Promise<Result<readonly CallHierarchyCall[], LspError>>;
  readonly outgoingCalls: (
    nodeId: string,
  ) => Promise<Result<readonly CallHierarchyCall[], LspError>>;
  readonly documentSymbols: (
    request: FileRequest,
  ) => Promise<Result<readonly DocumentSymbolView[], LspError>>;
  /**
   * Where the symbol at a position is defined (`textDocument/definition`), or where its type is
   * (`textDocument/typeDefinition`). Location links answer their selection range. Read-only.
   */
  readonly definition: (
    request: DefinitionRequest,
  ) => Promise<Result<readonly LocationView[], LspError>>;
  /**
   * What the server says about the symbol at a position (`textDocument/hover`): Markdown and the
   * token's range, or `undefined` when it has nothing to say there. Read-only.
   */
  readonly hover: (request: PositionRequest) => Promise<Result<HoverView | undefined, LspError>>;
  /** Whether a server that handles the file advertises `renameProvider` (ADR 0163); starts it to know. */
  readonly renameSupport: (request: FileRequest) => Promise<Result<boolean, LspError>>;
  /** `textDocument/prepareRename` at a position, when the server has it. Read-only. */
  readonly prepareRename: (
    request: PrepareRenameRequest,
  ) => Promise<Result<PrepareRenameAnswer, LspError>>;
  /**
   * `textDocument/rename`: the server's `WorkspaceEdit` for giving the symbol at a position
   * `newName`. A read: nothing is applied, no `didChange` is sent.
   */
  readonly rename: (request: RenameRequest) => Promise<Result<RenameAnswer, LspError>>;
  readonly status: () => readonly ServerStatus[];
  /**
   * Stops every server of the workspace `root` (resolved to its real path), so the next request
   * starts it afresh: tsserver doesn't notice a `node_modules` that appeared after it started
   * (ADR 0095: Restart Language Servers). Resolves once they have exited. An unknown root is a no-op.
   */
  readonly restart: (root: string) => Promise<void>;
  /** Shuts every server down cleanly (`shutdown`, `exit`, then signals). Idempotent. */
  readonly dispose: () => Promise<void>;
}

interface ServerEntry {
  readonly key: string;
  /** The checkout this server belongs to; trust, the environment and path mapping are of it. */
  readonly workspace: WorkspaceRoot;
  /** Where the server runs: the checkout, or the module root inside it a marker names. */
  readonly root: WorkspaceRoot;
  readonly definition: ServerDefinition;
  session: ServerSession | undefined;
  starting: Promise<Result<ServerSession, LspError>> | undefined;
  /** One stopwatch per unexpected exit, started when it happened. */
  crashes: Stopwatch[];
  lastExit: ServerExit | undefined;
  restarts: number;
}

interface OpenedFile {
  readonly entry: ServerEntry;
  readonly session: ServerSession;
  readonly file: WorkspaceFile;
  readonly document: SyncedDocument;
}

interface NodeHandle {
  readonly entry: ServerEntry;
  readonly item: LspCallHierarchyItem;
}

const defaultMaxFileBytes = 8 * 1024 * 1024;
const idleTimerPeriod = Temporal.Duration.from({ minutes: 1 });
/** How long a rename waits for the server to report on the file before asking (ADR 0163). */
const renameSettleTimeout = Temporal.Duration.from({ seconds: 5 });

/**
 * Creates the LSP multiplexer. It owns its server processes: callers must `dispose` it (main does
 * so on quit). Servers stop after `idleTimeout`, restart lazily on the next call, and are given
 * up on (until the window passes) after `maxRestarts` unexpected exits.
 */
export function createLspMultiplexer(options: LspMultiplexerOptions = {}): LspMultiplexer {
  const servers = options.servers ?? [typescriptServerDefinition()];
  const { logger } = options;
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const entries = new Map<string, ServerEntry>();
  const nodes = new LruCache<string, NodeHandle>(options.maxNodes ?? 10_000);
  const idleTimeout = options.idleTimeout ?? Temporal.Duration.from({ minutes: 5 });
  const lifecycle = { isDisposed: false };

  /** Every server that handles the file, in registry order (ADR 0111). */
  const serversIn = (workspace: WorkspaceRoot): readonly ServerDefinition[] => {
    return options.serversFor?.(workspace) ?? servers;
  };

  const definitionsFor = (workspace: WorkspaceRoot, file: WorkspaceFile): ServerDefinition[] => {
    const extension = path.extname(file.absolutePath).toLowerCase();
    return serversIn(workspace).filter((server) => Object.hasOwn(server.languageIds, extension));
  };

  const startSession = async (entry: ServerEntry): Promise<Result<ServerSession, LspError>> => {
    const { definition, root, workspace } = entry;
    const decision = (options.trust ?? checkServerTrust)({
      kind: 'server-program',
      serverId: definition.id,
      source: definition.source,
      origin: definition.origin ?? 'builtin',
      root: workspace,
    });
    if (!decision.allowed) {
      return err({ kind: 'server-untrusted', serverId: definition.id, reason: decision.reason });
    }
    const environment =
      (await options.environmentFor?.(workspace)) ?? options.environment ?? process.env;
    const searchDirectories: string[] = [];
    if (options.trustWorkspaceBinaries === true) {
      searchDirectories.push(path.join(workspace, 'node_modules', '.bin'));
    }
    searchDirectories.push(...(options.searchDirectories ?? []));
    let command: Result<string, LspError>;
    if (definition.source === 'project') {
      command = await resolveProjectCommand({
        serverId: definition.id,
        workspace,
        command: definition.command,
      });
    } else {
      command = await findServerCommand({
        serverId: definition.id,
        command: definition.command,
        searchDirectories,
        pathVariable: environment['PATH'],
      });
    }
    if (!command.ok) {
      return command;
    }
    const started = await startLanguageServer({
      definition,
      root,
      commandPath: command.value,
      env: createServerEnvironment(environment, definition.env, definition.inheritEnv),
      ...(logger !== undefined && { logger }),
      ...(options.requestTimeout !== undefined && { requestTimeout: options.requestTimeout }),
    });
    if (!started.ok) {
      return started;
    }
    const session = new ServerSession(started.value, {
      ...(options.maxOpenDocuments !== undefined && { maxOpenDocuments: options.maxOpenDocuments }),
    });
    void watchExit(entry, session);
    return ok(session);
  };

  const watchExit = async (entry: ServerEntry, session: ServerSession): Promise<void> => {
    const exit = await session.server.exited;
    if (entry.session === session) {
      entry.session = undefined;
    }
    if (exit.expected) {
      return;
    }

    entry.crashes.push(new Stopwatch());
    entry.lastExit = exit;
  };

  const acquire = async (
    location: ServerLocation,
    definition: ServerDefinition,
  ): Promise<Result<ServerSession, LspError>> => {
    const { workspace, root } = location;
    if (lifecycle.isDisposed) {
      return err({ kind: 'disposed' });
    }
    const key = `${definition.id}\0${root}`;
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = {
        key,
        workspace,
        root,
        definition,
        session: undefined,
        starting: undefined,
        crashes: [],
        lastExit: undefined,
        restarts: 0,
      };
      entries.set(key, entry);
    }
    if (entry.session !== undefined) {
      return ok(entry.session);
    }
    if (entry.starting !== undefined) {
      return entry.starting;
    }
    const restartWindow = options.restartWindow ?? Temporal.Duration.from({ minutes: 5 });
    entry.crashes = entry.crashes.filter((crash) => {
      return Temporal.Duration.compare(crash.elapsed(), restartWindow) <= 0;
    });
    if (entry.crashes.length > (options.maxRestarts ?? 3)) {
      return err({
        kind: 'server-exited',
        serverId: definition.id,
        exitCode: entry.lastExit?.exitCode,
        signal: entry.lastExit?.signal,
        restartsExhausted: true,
      });
    }
    const current = entry;
    if (current.crashes.length > 0) {
      current.restarts += 1;
    }
    current.starting = (async (): Promise<Result<ServerSession, LspError>> => {
      const started = await startSession(current);
      current.starting = undefined;
      if (!started.ok) {
        current.crashes.push(new Stopwatch());
        return started;
      }
      if (lifecycle.isDisposed) {
        await started.value.dispose();
        return err({ kind: 'disposed' });
      }
      current.session = started.value;
      return started;
    })();
    return current.starting;
  };

  const readDocument = async ({
    absolutePath,
    displayPath,
  }: DocumentPaths): Promise<Result<Pick<DocumentContent, 'text' | 'stamp'>, LspError>> => {
    try {
      // One open, then the handle's own size and text (ADR 0082): a file swapped in between
      // can't be read past the size check.
      await using handle = await open(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK);
      const stats = await handle.stat({ bigint: true });
      const size = Number(stats.size);
      if (size > maxFileBytes) {
        return err({
          kind: 'file-too-large',
          path: displayPath,
          bytes: size,
          maxBytes: maxFileBytes,
        });
      }
      const text = await handle.readFile('utf8');
      return ok({ text, stamp: stampFrom(stats) });
    } catch {
      return err({
        kind: 'invalid-path',
        path: displayPath,
        reason: 'does not exist or is unreadable',
      });
    }
  };

  /** Re-reads open documents whose files changed on disk, so the server never works on stale text. */
  const refreshOpenDocuments = async (
    session: ServerSession,
    root: WorkspaceRoot,
  ): Promise<void> => {
    for (const document of session.openDocuments) {
      let stamp: FileStamp | undefined;
      try {
        stamp = stampFrom(await stat(document.absolutePath, { bigint: true }));
      } catch {
        stamp = undefined;
      }
      if (stamp === undefined) {
        session.close(document.uri);
        continue;
      }
      if (stamp.mtime.equals(document.stamp.mtime) && stamp.size === document.stamp.size) {
        continue;
      }
      const resolved = await resolveWorkspaceFile(root, document.absolutePath);
      if (!resolved.ok) {
        session.close(document.uri);
        continue;
      }
      const definition = serversIn(root).find((server) => {
        return server.id === session.server.serverId;
      });
      const content = await readDocument({
        absolutePath: document.absolutePath,
        displayPath: document.absolutePath,
      });
      if (definition === undefined || !content.ok) {
        session.close(document.uri);
        continue;
      }
      session.sync({
        uri: resolved.value.uri,
        absolutePath: resolved.value.absolutePath,
        languageId: languageIdOf(definition, resolved.value),
        ...content.value,
      });
    }
  };

  /** Resolves and reads a file of a checkout once, to open it on each server that handles it. */
  const prepareFile = async (request: FileRequest): Promise<Result<PreparedFile, LspError>> => {
    const workspace = await resolveWorkspaceRoot(request.root);
    if (!workspace.ok) {
      return workspace;
    }
    const file = await resolveWorkspaceFile(workspace.value, request.path);
    if (!file.ok) {
      return file;
    }
    const definitions = definitionsFor(workspace.value, file.value);
    if (definitions.length === 0) {
      return err({ kind: 'unsupported-language', path: file.value.relativePath });
    }
    const content = await readDocument({
      absolutePath: file.value.absolutePath,
      displayPath: file.value.relativePath,
    });
    if (!content.ok) {
      return content;
    }
    return ok({
      workspace: workspace.value,
      file: file.value,
      content: content.value,
      definitions,
    });
  };

  /** Starts (if need be) the server in the file's root, and syncs the file to it. */
  const openOn = async (
    prepared: PreparedFile,
    target: OpenTarget,
  ): Promise<Result<OpenedFile, LspError>> => {
    const { workspace, file, content } = prepared;
    const { definition, shouldRecheck } = target;
    const root = await findServerRoot({
      workspace,
      file: file.absolutePath,
      markers: definition.rootMarkers ?? [],
    });
    const session = await acquire({ workspace, root }, definition);
    if (!session.ok) {
      return session;
    }
    const entry = entries.get(`${definition.id}\0${root}`);
    if (entry === undefined) {
      return err({ kind: 'disposed' });
    }
    await refreshOpenDocuments(session.value, workspace);
    const document = session.value.sync(
      {
        uri: file.uri,
        absolutePath: file.absolutePath,
        languageId: languageIdOf(definition, file),
        ...content,
      },
      { recheck: shouldRecheck },
    );
    return ok({ entry, session: session.value, file, document });
  };

  /**
   * Opens the file on the first server that handles it and advertises `capability`, in registry
   * order (ADR 0111). A server that cannot start, or lacks the capability, is passed over; if none
   * serves it, the first such failure is the answer.
   */
  const openCapable = async (
    request: FileRequest,
    capability: Capability,
  ): Promise<Result<OpenedFile, LspError>> => {
    const prepared = await prepareFile(request);
    if (!prepared.ok) {
      return prepared;
    }
    let firstFailure: Err<LspError> | undefined;
    for (const definition of prepared.value.definitions) {
      const opened = await openOn(prepared.value, { definition, shouldRecheck: false });
      if (!opened.ok) {
        firstFailure ??= opened;
        continue;
      }
      const capable = requireCapability(opened.value, capability);
      if (capable.ok) {
        return opened;
      }
      firstFailure ??= capable;
    }
    return (
      firstFailure ?? err({ kind: 'unsupported-language', path: prepared.value.file.relativePath })
    );
  };

  /** One server's diagnostics for a prepared file, as its tagged views. */
  const diagnosticsOn = async (
    prepared: PreparedFile,
    target: DiagnosticsTarget,
  ): Promise<DiagnosticsAnswer> => {
    const { definition } = target;
    const opened = await openOn(prepared, { definition, shouldRecheck: true });
    if (!opened.ok) {
      return { serverId: definition.id, result: opened };
    }
    const { session, entry, document } = opened.value;
    const settled = await session.diagnostics(document, {
      timeout:
        target.timeout ?? options.diagnosticsTimeout ?? Temporal.Duration.from({ seconds: 20 }),
      grace: options.diagnosticsGrace ?? Temporal.Duration.from({ milliseconds: 1500 }),
      quiet: definition.diagnosticsQuiet,
    });
    if (!settled.ok) {
      return { serverId: definition.id, result: settled };
    }
    const related = settled.value.diagnostics.flatMap((diagnostic) => {
      return (diagnostic.relatedInformation ?? []).map((item) => item.location.uri);
    });
    const mapper = await mapperFor(session, entry.workspace, [document.uri, ...related]);
    return {
      serverId: definition.id,
      result: ok({
        freshness: settled.value.freshness,
        diagnostics: settled.value.diagnostics.map((diagnostic) => {
          return mapper.diagnostic(document.uri, diagnostic);
        }),
      }),
    };
  };

  /** Lines for every URI a result mentions, read from disk inside the root when not open. */
  const mapperFor = async (
    session: ServerSession,
    workspace: WorkspaceRoot,
    uris: readonly string[],
  ): Promise<ViewMapper> => {
    const encoding = session.server.capabilities.positionEncoding;
    const lines = new Map<string, LineIndex>();
    const linesOf = async (uri: string): Promise<LineIndex | undefined> => {
      const open = session.linesOf(uri);
      if (open !== undefined) {
        return open;
      }
      const text = await readInsideRoot(workspace, uri, maxFileBytes);
      if (text === undefined) {
        return undefined;
      }
      return new LineIndex(text);
    };
    if (encoding !== positionEncodings.utf16) {
      const distinct = new Set(uris.map((value) => normalizeUri(value)));
      for (const uri of distinct) {
        const index = await linesOf(uri);
        if (index !== undefined) {
          lines.set(uri, index);
        }
      }
    }
    return createViewMapper({
      root: workspace,
      serverId: session.server.serverId,
      encoding,
      lines: (uri): LineIndex | undefined => {
        return lines.get(uri);
      },
    });
  };

  const nodesFrom = async (
    { session, entry }: ServedFile,
    edges: readonly LspCallHierarchyEdge[],
    callSiteUri: string | undefined,
  ): Promise<CallHierarchyCall[]> => {
    const uris = edges.map((edge) => edge.item.uri);
    if (callSiteUri !== undefined) {
      uris.push(callSiteUri);
    }
    const mapper = await mapperFor(session, entry.workspace, uris);
    return edges.map((edge) => {
      const id = randomUUID();
      nodes.set(id, { entry, item: edge.item });
      const siteUri = callSiteUri ?? edge.item.uri;
      return {
        node: mapper.node(id, edge.item),
        callSites: edge.fromRanges.map((range) => mapper.range(siteUri, range)),
      };
    });
  };

  const expand = async (
    nodeId: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<Result<readonly CallHierarchyCall[], LspError>> => {
    const handle = nodes.get(nodeId);
    if (handle === undefined) {
      return err({ kind: 'unknown-node', nodeId });
    }
    const { workspace, root, definition } = handle.entry;
    const session = await acquire({ workspace, root }, definition);
    if (!session.ok) {
      return session;
    }
    const served: ServedFile = { session: session.value, entry: handle.entry };
    const capable = requireCapability(served, 'callHierarchy');
    if (!capable.ok) {
      return capable;
    }
    await refreshOpenDocuments(session.value, handle.entry.workspace);
    const { method, shape } = callDirections[direction];
    const result = await session.value.request(method, { item: handle.item });
    if (!result.ok) {
      return result;
    }
    const edges = parseCallHierarchyItems(result.value, shape);
    let callSiteUri: string | undefined;
    if (direction === 'outgoing') {
      callSiteUri = handle.item.uri;
    }
    return ok(await nodesFrom(served, edges, callSiteUri));
  };

  const stopIdleServers = (): void => {
    for (const entry of entries.values()) {
      const { session } = entry;
      if (session === undefined || Temporal.Duration.compare(session.idle, idleTimeout) < 0) {
        continue;
      }

      entry.session = undefined;
      logger?.info('lsp: stopping idle server', {
        serverId: entry.definition.id,
        root: entry.root,
      });
      void session.dispose();
    }
  };
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  if (idleTimeout.sign > 0) {
    idleTimer = setInterval(
      stopIdleServers,
      shorterOf(idleTimeout, idleTimerPeriod).total('milliseconds'),
    );
    idleTimer.unref();
  }

  return {
    getDiagnostics: async (request): Promise<Result<DiagnosticsReport, LspError>> => {
      const prepared = await prepareFile(request);
      if (!prepared.ok) {
        return prepared;
      }
      const asked = prepared.value.definitions.filter((definition) => {
        return definition.diagnostics !== false;
      });
      if (asked.length === 0) {
        return err({ kind: 'unsupported-language', path: prepared.value.file.relativePath });
      }
      const answers = await Promise.all(
        asked.map(async (definition) => {
          return diagnosticsOn(prepared.value, {
            definition,
            ...(request.timeout !== undefined && { timeout: request.timeout }),
          });
        }),
      );
      return combineDiagnostics(prepared.value.file.relativePath, answers);
    },

    prepareCallHierarchy: async (
      request,
    ): Promise<Result<readonly CallHierarchyNode[], LspError>> => {
      const opened = await openCapable(request, 'callHierarchy');
      if (!opened.ok) {
        return opened;
      }
      const { session, entry } = opened.value;
      const result = await session.request(
        'textDocument/prepareCallHierarchy',
        positionParams(opened.value, request.position),
      );
      if (!result.ok) {
        return result;
      }
      const edges = parseCallHierarchyItems(result.value, 'items');
      const calls = await nodesFrom({ session, entry }, edges, undefined);
      return ok(calls.map((call) => call.node));
    },

    incomingCalls: async (nodeId): Promise<Result<readonly CallHierarchyCall[], LspError>> => {
      return expand(nodeId, 'incoming');
    },

    outgoingCalls: async (nodeId): Promise<Result<readonly CallHierarchyCall[], LspError>> => {
      return expand(nodeId, 'outgoing');
    },

    documentSymbols: async (request): Promise<Result<readonly DocumentSymbolView[], LspError>> => {
      const opened = await openCapable(request, 'documentSymbol');
      if (!opened.ok) {
        return opened;
      }
      const { session, entry, document } = opened.value;
      const result = await session.request('textDocument/documentSymbol', {
        textDocument: { uri: document.uri },
      });
      if (!result.ok) {
        return result;
      }
      const mapper = await mapperFor(session, entry.workspace, [document.uri]);
      return ok(
        parseDocumentSymbols(result.value).map((symbol) => mapper.symbol(document.uri, symbol)),
      );
    },

    definition: async (request): Promise<Result<readonly LocationView[], LspError>> => {
      const { capability, method } = definitionKinds[request.kind ?? 'definition'];
      const opened = await openCapable(request, capability);
      if (!opened.ok) {
        return opened;
      }
      const { session, entry } = opened.value;
      const result = await session.request(method, positionParams(opened.value, request.position));
      if (!result.ok) {
        return result;
      }
      const locations = parseLocations(result.value);
      const mapper = await mapperFor(
        session,
        entry.workspace,
        locations.map((location) => location.uri),
      );
      return ok(locations.map((location) => mapper.location(location)));
    },

    hover: async (request): Promise<Result<HoverView | undefined, LspError>> => {
      const opened = await openCapable(request, 'hover');
      if (!opened.ok) {
        return opened;
      }
      const { session, entry } = opened.value;
      const result = await session.request(
        'textDocument/hover',
        positionParams(opened.value, request.position),
      );
      if (!result.ok) {
        return result;
      }
      const hover = parseHover(result.value);
      if (hover === undefined) {
        return ok(undefined);
      }
      const mapper = await mapperFor(session, entry.workspace, [opened.value.document.uri]);
      if (hover.range === undefined) {
        return ok({ markdown: hover.markdown, range: undefined });
      }
      return ok({
        markdown: hover.markdown,
        range: mapper.range(opened.value.document.uri, hover.range),
      });
    },

    renameSupport: async (request): Promise<Result<boolean, LspError>> => {
      const opened = await openCapable(request, 'rename');
      if (opened.ok) {
        return ok(true);
      }
      if (
        opened.error.kind === 'capability-missing' ||
        opened.error.kind === 'unsupported-language'
      ) {
        return ok(false);
      }
      return opened;
    },

    prepareRename: async (request): Promise<Result<PrepareRenameAnswer, LspError>> => {
      const opened = await openCapable(request, 'rename');
      if (!opened.ok) {
        return opened;
      }
      const { session, entry } = opened.value;
      if (!session.server.capabilities.prepareRename) {
        return ok({ kind: 'default' });
      }
      const result = await session.request(
        'textDocument/prepareRename',
        positionParams(opened.value, request.position),
        { signal: request.signal },
      );
      if (!result.ok) {
        return result;
      }
      const answer = parsePrepareRename(result.value);
      if (answer.kind !== 'range') {
        return ok(answer);
      }
      const mapper = await mapperFor(session, entry.workspace, [opened.value.document.uri]);
      return ok({
        kind: 'range',
        range: mapper.range(opened.value.document.uri, answer.range),
        placeholder: answer.placeholder,
      });
    },

    rename: async (request): Promise<Result<RenameAnswer, LspError>> => {
      const opened = await openCapable(request, 'rename');
      if (!opened.ok) {
        return opened;
      }
      const { session, entry, document } = opened.value;
      // A server still loading its project renames only what it has read (tsserver renames an
      // import's local name alone): wait until it has reported on the file, as diagnostics do.
      await session.diagnostics(document, {
        timeout: renameSettleTimeout,
        grace: options.diagnosticsGrace ?? Temporal.Duration.from({ milliseconds: 1500 }),
        quiet: entry.definition.diagnosticsQuiet,
      });
      const result = await session.request(
        'textDocument/rename',
        { ...positionParams(opened.value, request.position), newName: request.newName },
        { signal: request.signal },
      );
      if (!result.ok) {
        return result;
      }
      const parsed = parseWorkspaceEdit(result.value);
      const byPath = new Map<string, LspTextEdit[]>();
      let outside = 0;
      for (const file of parsed.files) {
        const resolved = await resolveEditedFile(entry.workspace, file.uri);
        if (resolved === undefined) {
          outside += 1;
          continue;
        }
        byPath
          .getOrInsertComputed(resolved, () => {
            return [];
          })
          .push(...file.edits);
      }
      return ok({
        encoding: session.server.capabilities.positionEncoding,
        files: Array.from(byPath, ([filePath, edits]) => {
          return { path: filePath, edits };
        }).toSorted((a, b) => compareText(a.path, b.path)),
        outside,
        resourceOperations: parsed.resourceOperations,
        malformed: parsed.malformed,
      });
    },

    status: (): readonly ServerStatus[] => {
      const statuses: ServerStatus[] = [];
      for (const entry of entries.values()) {
        const base = { serverId: entry.definition.id, root: entry.root, restarts: entry.restarts };
        if (entry.session !== undefined) {
          statuses.push({
            ...base,
            state: 'running',
            pid: entry.session.server.pid,
            openDocuments: entry.session.openDocuments.length,
          });
        } else if (entry.starting !== undefined) {
          statuses.push({ ...base, state: 'starting', pid: undefined, openDocuments: 0 });
        }
      }
      return statuses;
    },

    restart: async (root): Promise<void> => {
      const resolved = await resolveWorkspaceRoot(root);
      if (!resolved.ok) {
        return;
      }
      const stopping: Promise<void>[] = [];
      for (const entry of entries.values()) {
        if (entry.workspace !== resolved.value) {
          continue;
        }
        const { session } = entry;
        entry.session = undefined;
        if (session === undefined) {
          continue;
        }

        logger?.info('lsp: restarting a server after an install', {
          serverId: entry.definition.id,
          root: entry.root,
        });
        stopping.push(session.dispose());
      }
      await Promise.all(stopping);
    },

    dispose: async (): Promise<void> => {
      lifecycle.isDisposed = true;
      if (idleTimer !== undefined) {
        clearInterval(idleTimer);
      }
      const stopping = Array.from(entries.values(), async (entry) => {
        let started: Result<ServerSession, LspError> | undefined;
        if (entry.starting !== undefined) {
          started = await entry.starting;
        }
        let session = entry.session;
        if (session === undefined && started?.ok === true) {
          session = started.value;
        }
        entry.session = undefined;
        await session?.dispose();
      });
      await Promise.all(stopping);
      nodes.clear();
    },
  };
}

/** An opened file's session and the server entry it belongs to. */
type ServedFile = Pick<OpenedFile, 'session' | 'entry'>;

/** Where a server runs: the checkout it belongs to, and the root inside it. */
interface ServerLocation {
  readonly workspace: WorkspaceRoot;
  readonly root: WorkspaceRoot;
}

/** A file of a checkout, resolved and read once, and every server that handles it. */
interface PreparedFile {
  readonly workspace: WorkspaceRoot;
  readonly file: WorkspaceFile;
  readonly content: Pick<DocumentContent, 'text' | 'stamp'>;
  /** In registry order, never empty. */
  readonly definitions: readonly ServerDefinition[];
}

/** Which server to open a file on, and whether to send its text again to make it re-check. */
interface OpenTarget {
  readonly definition: ServerDefinition;
  readonly shouldRecheck: boolean;
}

interface DiagnosticsTarget {
  readonly definition: ServerDefinition;
  readonly timeout?: Temporal.Duration;
}

/** One server's diagnostics for a file, or why it gave none. */
interface DiagnosticsAnswer {
  readonly serverId: string;
  readonly result: Result<
    { readonly freshness: DiagnosticsFreshness; readonly diagnostics: readonly DiagnosticView[] },
    LspError
  >;
}

type Capability =
  'callHierarchy' | 'documentSymbol' | 'definition' | 'typeDefinition' | 'hover' | 'rename';

const freshnessOrder: readonly DiagnosticsFreshness[] = ['fresh', 'assumed-unchanged', 'timed-out'];

/**
 * The union of what the servers answered, in registry order (ADR 0111): their diagnostics, the
 * least certain freshness, and the servers that gave none. When none answered, the first failure.
 */
function combineDiagnostics(
  filePath: string,
  answers: readonly DiagnosticsAnswer[],
): Result<DiagnosticsReport, LspError> {
  const diagnostics: DiagnosticView[] = [];
  const skipped: SkippedServer[] = [];
  let freshness: DiagnosticsFreshness | undefined;
  for (const answer of answers) {
    if (!answer.result.ok) {
      skipped.push({ serverId: answer.serverId, error: answer.result.error });
      continue;
    }
    diagnostics.push(...answer.result.value.diagnostics);
    const worse = answer.result.value.freshness;
    if (
      freshness === undefined ||
      freshnessOrder.indexOf(worse) > freshnessOrder.indexOf(freshness)
    ) {
      freshness = worse;
    }
  }
  if (freshness === undefined) {
    const [first] = skipped;
    return err(first?.error ?? { kind: 'unsupported-language', path: filePath });
  }
  return ok({ path: filePath, freshness, diagnostics, skipped });
}

/** Where to read a document from, and how errors name it. */
interface DocumentPaths {
  readonly absolutePath: string;
  readonly displayPath: string;
}

const callDirections = {
  incoming: { method: 'callHierarchy/incomingCalls', shape: 'from' },
  outgoing: { method: 'callHierarchy/outgoingCalls', shape: 'to' },
} as const;

const definitionKinds = {
  definition: { capability: 'definition', method: 'textDocument/definition' },
  'type-definition': { capability: 'typeDefinition', method: 'textDocument/typeDefinition' },
} as const;

function requireCapability(
  opened: ServedFile,
  capability: Capability,
): Result<undefined, LspError> {
  if (opened.session.server.capabilities[capability]) {
    return ok(undefined);
  }
  return err({ kind: 'capability-missing', serverId: opened.entry.definition.id, capability });
}

function shorterOf(a: Temporal.Duration, b: Temporal.Duration): Temporal.Duration {
  if (Temporal.Duration.compare(a, b) <= 0) {
    return a;
  }
  return b;
}

function positionParams(opened: OpenedFile, position: Position): Record<string, unknown> {
  const encoding = opened.session.server.capabilities.positionEncoding;
  let { character } = position;
  if (encoding !== positionEncodings.utf16) {
    character = convertCharacter(opened.document.lines.lineText(position.line), character, {
      from: positionEncodings.utf16,
      to: encoding,
    });
  }
  return {
    textDocument: { uri: opened.document.uri },
    position: { line: position.line, character },
  };
}

function languageIdOf(definition: ServerDefinition, file: WorkspaceFile): string {
  return definition.languageIds[path.extname(file.absolutePath).toLowerCase()] ?? 'plaintext';
}

/**
 * The checkout-relative real path of a file a server's edit names, or `undefined` when the URI is
 * no file URI or doesn't resolve, after symlinks, to a regular file inside the checkout.
 */
async function resolveEditedFile(
  workspace: WorkspaceRoot,
  uri: string,
): Promise<string | undefined> {
  let filePath: string;
  try {
    filePath = fileURLToPath(uri);
  } catch {
    return undefined;
  }
  const resolved = await resolveWorkspaceFile(workspace, filePath);
  if (!resolved.ok) {
    return undefined;
  }
  return resolved.value.relativePath;
}

/** Code-unit order, the same on every machine. */
function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

async function readInsideRoot(
  root: WorkspaceRoot,
  uri: string,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    const filePath = fileURLToPath(uri);
    if (!isWithinDirectory(root, filePath)) {
      return undefined;
    }
    const resolved = await resolveWorkspaceFile(root, filePath);
    if (!resolved.ok || resolved.value.bytes > maxBytes) {
      return undefined;
    }
    return await readFile(resolved.value.absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

function stampFrom(stats: BigIntStats): FileStamp {
  return { mtime: Temporal.Instant.fromEpochNanoseconds(stats.mtimeNs), size: Number(stats.size) };
}
