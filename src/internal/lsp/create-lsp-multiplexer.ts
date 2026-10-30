import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LruCache } from '#x/collections/lru-cache.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { convertCharacter } from './convert-character.ts';
import { createServerEnvironment } from './create-server-environment.ts';
import { createViewMapper } from './create-view-mapper.ts';
import type { ViewMapper } from './create-view-mapper.ts';
import { findServerCommand } from './find-server-command.ts';
import { isWithinDirectory } from './is-within-directory.ts';
import { LineIndex } from './line-index.ts';
import type { LspError } from './lsp-error.ts';
import type {
  CallHierarchyCall,
  CallHierarchyNode,
  DiagnosticsReport,
  DocumentSymbolView,
  Position,
  ServerStatus,
} from './lsp-model.ts';
import type { LspCallHierarchyItem } from './lsp-protocol.ts';
import { normalizeUri } from './normalize-uri.ts';
import { parseCallHierarchyItems } from './parse-call-hierarchy-items.ts';
import type { LspCallHierarchyEdge } from './parse-call-hierarchy-items.ts';
import { parseDocumentSymbols } from './parse-document-symbols.ts';
import { resolveWorkspaceFile } from './resolve-workspace-file.ts';
import type { WorkspaceFile } from './resolve-workspace-file.ts';
import { resolveWorkspaceRoot } from './resolve-workspace-root.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import type { ServerDefinition } from './server-definition.ts';
import { ServerSession } from './server-session.ts';
import type { FileStamp, SyncedDocument } from './server-session.ts';
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
  readonly logger?: Logger;
  /** Per request. Defaults to 15 s. */
  readonly requestTimeoutMs?: number;
  /** Default upper bound for `getDiagnostics`. Defaults to 20 s. */
  readonly diagnosticsTimeoutMs?: number;
  /** How long to wait for a new report after a change when the old one stands. Defaults to 1.5 s. */
  readonly diagnosticsGraceMs?: number;
  /** Stop a server after this long without use; 0 never does. Defaults to 5 minutes. */
  readonly idleTimeoutMs?: number;
  /** Unexpected exits tolerated per window before giving up. Defaults to 3 per 5 minutes. */
  readonly maxRestarts?: number;
  readonly restartWindowMs?: number;
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
  /** Overrides `diagnosticsTimeoutMs`. */
  readonly timeoutMs?: number;
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
  readonly status: () => readonly ServerStatus[];
  /** Shuts every server down cleanly (`shutdown`, `exit`, then signals). Idempotent. */
  readonly dispose: () => Promise<void>;
}

interface ServerEntry {
  readonly key: string;
  readonly root: WorkspaceRoot;
  readonly definition: ServerDefinition;
  session: ServerSession | undefined;
  starting: Promise<Result<ServerSession, LspError>> | undefined;
  crashes: Temporal.Instant[];
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

/**
 * Creates the LSP multiplexer. It owns its server processes: callers must `dispose` it (main does
 * so on quit). Servers stop after `idleTimeoutMs`, restart lazily on the next call, and are given
 * up on (until the window passes) after `maxRestarts` unexpected exits.
 */
export function createLspMultiplexer(options: LspMultiplexerOptions = {}): LspMultiplexer {
  const servers = options.servers ?? [typescriptServerDefinition()];
  const { logger } = options;
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const entries = new Map<string, ServerEntry>();
  const nodes = new LruCache<string, NodeHandle>(options.maxNodes ?? 10_000);
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const idleTimeout = Temporal.Duration.from({ milliseconds: idleTimeoutMs });
  const lifecycle = { isDisposed: false };

  const definitionFor = (file: WorkspaceFile): ServerDefinition | undefined => {
    const extension = path.extname(file.absolutePath).toLowerCase();
    return servers.find((server) => Object.hasOwn(server.languageIds, extension));
  };

  const startSession = async (entry: ServerEntry): Promise<Result<ServerSession, LspError>> => {
    const { definition, root } = entry;
    const environment = options.environment ?? process.env;
    const searchDirectories = [
      ...(options.trustWorkspaceBinaries === true ? [path.join(root, 'node_modules', '.bin')] : []),
      ...(options.searchDirectories ?? []),
    ];
    const command = await findServerCommand({
      serverId: definition.id,
      command: definition.command,
      searchDirectories,
      pathVariable: environment['PATH'],
    });
    if (!command.ok) {
      return command;
    }
    const started = await startLanguageServer({
      definition,
      root,
      commandPath: command.value,
      env: createServerEnvironment(environment, definition.env),
      ...(logger !== undefined && { logger }),
      ...(options.requestTimeoutMs !== undefined && { requestTimeoutMs: options.requestTimeoutMs }),
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

    entry.crashes.push(Temporal.Now.instant());
    entry.lastExit = exit;
  };

  const acquire = async (
    root: WorkspaceRoot,
    definition: ServerDefinition,
  ): Promise<Result<ServerSession, LspError>> => {
    if (lifecycle.isDisposed) {
      return err({ kind: 'disposed' });
    }
    const key = `${definition.id}\0${root}`;
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = {
        key,
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
    const windowStart = Temporal.Now.instant().subtract({
      milliseconds: options.restartWindowMs ?? 5 * 60_000,
    });
    entry.crashes = entry.crashes.filter((at) => Temporal.Instant.compare(at, windowStart) >= 0);
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
        current.crashes.push(Temporal.Now.instant());
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

  const readDocument = async (
    absolutePath: string,
    displayPath: string,
  ): Promise<Result<{ text: string; stamp: FileStamp }, LspError>> => {
    try {
      const stats = await stat(absolutePath, { bigint: true });
      const size = Number(stats.size);
      if (size > maxFileBytes) {
        return err({
          kind: 'file-too-large',
          path: displayPath,
          bytes: size,
          maxBytes: maxFileBytes,
        });
      }
      const text = await readFile(absolutePath, 'utf8');
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
      const definition = definitionFor(resolved.value);
      const content = await readDocument(document.absolutePath, document.absolutePath);
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

  const openFile = async (
    request: FileRequest,
    shouldRecheck = false,
  ): Promise<Result<OpenedFile, LspError>> => {
    const root = await resolveWorkspaceRoot(request.root);
    if (!root.ok) {
      return root;
    }
    const file = await resolveWorkspaceFile(root.value, request.path);
    if (!file.ok) {
      return file;
    }
    const definition = definitionFor(file.value);
    if (definition === undefined) {
      return err({ kind: 'unsupported-language', path: file.value.relativePath });
    }
    const content = await readDocument(file.value.absolutePath, file.value.relativePath);
    if (!content.ok) {
      return content;
    }
    const session = await acquire(root.value, definition);
    if (!session.ok) {
      return session;
    }
    const entry = entries.get(`${definition.id}\0${root.value}`);
    if (entry === undefined) {
      return err({ kind: 'disposed' });
    }
    await refreshOpenDocuments(session.value, root.value);
    const document = session.value.sync(
      {
        uri: file.value.uri,
        absolutePath: file.value.absolutePath,
        languageId: languageIdOf(definition, file.value),
        ...content.value,
      },
      { recheck: shouldRecheck },
    );
    return ok({ entry, session: session.value, file: file.value, document });
  };

  /** Lines for every URI a result mentions, read from disk inside the root when not open. */
  const mapperFor = async (
    session: ServerSession,
    root: WorkspaceRoot,
    uris: readonly string[],
  ): Promise<ViewMapper> => {
    const encoding = session.server.capabilities.positionEncoding;
    const lines = new Map<string, LineIndex>();
    if (encoding !== positionEncodings.utf16) {
      const distinct = new Set(uris.map((value) => normalizeUri(value)));
      for (const uri of distinct) {
        const open = session.linesOf(uri);
        const text = open === undefined ? await readInsideRoot(root, uri, maxFileBytes) : undefined;
        const index = open ?? (text === undefined ? undefined : new LineIndex(text));
        if (index !== undefined) {
          lines.set(uri, index);
        }
      }
    }
    return createViewMapper({ root, encoding, lines: (uri) => lines.get(uri) });
  };

  const requireCapability = (
    opened: { readonly session: ServerSession; readonly entry: ServerEntry },
    capability: 'callHierarchy' | 'documentSymbol',
  ): Result<undefined, LspError> =>
    opened.session.server.capabilities[capability]
      ? ok(undefined)
      : err({ kind: 'capability-missing', serverId: opened.entry.definition.id, capability });

  const toNodes = async (
    session: ServerSession,
    entry: ServerEntry,
    edges: readonly LspCallHierarchyEdge[],
    callSiteUri: string | undefined,
  ): Promise<CallHierarchyCall[]> => {
    const uris = edges.map((edge) => edge.item.uri);
    const mapper = await mapperFor(
      session,
      entry.root,
      callSiteUri === undefined ? uris : [...uris, callSiteUri],
    );
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
    const session = await acquire(handle.entry.root, handle.entry.definition);
    if (!session.ok) {
      return session;
    }
    const capable = requireCapability(
      { session: session.value, entry: handle.entry },
      'callHierarchy',
    );
    if (!capable.ok) {
      return capable;
    }
    await refreshOpenDocuments(session.value, handle.entry.root);
    const method =
      direction === 'incoming' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls';
    const result = await session.value.request(method, { item: handle.item });
    if (!result.ok) {
      return result;
    }
    const edges = parseCallHierarchyItems(result.value, direction === 'incoming' ? 'from' : 'to');
    return ok(
      await toNodes(
        session.value,
        handle.entry,
        edges,
        direction === 'incoming' ? undefined : handle.item.uri,
      ),
    );
  };

  const idleTimer =
    idleTimeoutMs > 0
      ? setInterval(
          () => {
            for (const entry of entries.values()) {
              const { session } = entry;
              if (
                session === undefined ||
                Temporal.Duration.compare(session.idle, idleTimeout) < 0
              ) {
                continue;
              }

              entry.session = undefined;
              logger?.info('lsp: stopping idle server', {
                serverId: entry.definition.id,
                root: entry.root,
              });
              void session.dispose();
            }
          },
          Math.min(idleTimeoutMs, 60_000),
        )
      : undefined;
  idleTimer?.unref();

  return {
    getDiagnostics: async (request): Promise<Result<DiagnosticsReport, LspError>> => {
      const opened = await openFile(request, true);
      if (!opened.ok) {
        return opened;
      }
      const { session, entry, document, file } = opened.value;
      const settled = await session.diagnostics(document, {
        timeoutMs: request.timeoutMs ?? options.diagnosticsTimeoutMs ?? 20_000,
        graceMs: options.diagnosticsGraceMs ?? 1500,
        quietMs: entry.definition.diagnosticsQuietMs,
      });
      if (!settled.ok) {
        return settled;
      }
      const related = settled.value.diagnostics.flatMap((diagnostic) =>
        (diagnostic.relatedInformation ?? []).map((item) => item.location.uri),
      );
      const mapper = await mapperFor(session, entry.root, [document.uri, ...related]);
      return ok({
        path: file.relativePath,
        serverId: entry.definition.id,
        freshness: settled.value.freshness,
        diagnostics: settled.value.diagnostics.map((diagnostic) =>
          mapper.diagnostic(document.uri, diagnostic),
        ),
      });
    },

    prepareCallHierarchy: async (
      request,
    ): Promise<Result<readonly CallHierarchyNode[], LspError>> => {
      const opened = await openFile(request);
      if (!opened.ok) {
        return opened;
      }
      const capable = requireCapability(opened.value, 'callHierarchy');
      if (!capable.ok) {
        return capable;
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
      const calls = await toNodes(session, entry, edges, undefined);
      return ok(calls.map((call) => call.node));
    },

    incomingCalls: async (nodeId): Promise<Result<readonly CallHierarchyCall[], LspError>> =>
      expand(nodeId, 'incoming'),

    outgoingCalls: async (nodeId): Promise<Result<readonly CallHierarchyCall[], LspError>> =>
      expand(nodeId, 'outgoing'),

    documentSymbols: async (request): Promise<Result<readonly DocumentSymbolView[], LspError>> => {
      const opened = await openFile(request);
      if (!opened.ok) {
        return opened;
      }
      const capable = requireCapability(opened.value, 'documentSymbol');
      if (!capable.ok) {
        return capable;
      }
      const { session, entry, document } = opened.value;
      const result = await session.request('textDocument/documentSymbol', {
        textDocument: { uri: document.uri },
      });
      if (!result.ok) {
        return result;
      }
      const mapper = await mapperFor(session, entry.root, [document.uri]);
      return ok(
        parseDocumentSymbols(result.value).map((symbol) => mapper.symbol(document.uri, symbol)),
      );
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

    dispose: async (): Promise<void> => {
      lifecycle.isDisposed = true;
      if (idleTimer !== undefined) {
        clearInterval(idleTimer);
      }
      const stopping = Array.from(entries.values(), async (entry) => {
        const started = entry.starting === undefined ? undefined : await entry.starting;
        const session = entry.session ?? (started?.ok === true ? started.value : undefined);
        entry.session = undefined;
        await session?.dispose();
      });
      await Promise.all(stopping);
      nodes.clear();
    },
  };
}

function positionParams(opened: OpenedFile, position: Position): Record<string, unknown> {
  const encoding = opened.session.server.capabilities.positionEncoding;
  const character =
    encoding === positionEncodings.utf16
      ? position.character
      : convertCharacter(
          opened.document.lines.lineText(position.line),
          position.character,
          positionEncodings.utf16,
          encoding,
        );
  return {
    textDocument: { uri: opened.document.uri },
    position: { line: position.line, character },
  };
}

function languageIdOf(definition: ServerDefinition, file: WorkspaceFile): string {
  return definition.languageIds[path.extname(file.absolutePath).toLowerCase()] ?? 'plaintext';
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
    return !resolved.ok || resolved.value.bytes > maxBytes
      ? undefined
      : await readFile(resolved.value.absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

function stampFrom(stats: BigIntStats): FileStamp {
  return { mtime: Temporal.Instant.fromEpochNanoseconds(stats.mtimeNs), size: Number(stats.size) };
}
