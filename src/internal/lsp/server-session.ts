import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import { LineIndex } from './line-index.ts';
import type { LspError } from './lsp-error.ts';
import type { DiagnosticsFreshness } from './lsp-model.ts';
import type { LspDiagnostic } from './lsp-protocol.ts';
import { normalizeUri } from './normalize-uri.ts';
import { parseDiagnostics } from './parse-diagnostics.ts';
import type { LanguageServer, ServerExit, ServerRequestOptions } from './start-language-server.ts';

/** A document as the server currently sees it. */
export interface SyncedDocument {
  /** Normalized URI (`normalizeUri`). */
  readonly uri: string;
  readonly absolutePath: string;
  readonly version: number;
  readonly lines: LineIndex;
  /** The text differed from what the server had (or the document was just opened). */
  readonly changed: boolean;
}

/** On-disk identity used to skip re-reading unchanged files. */
export interface FileStamp {
  readonly mtime: Temporal.Instant;
  readonly size: number;
}

export interface DocumentContent {
  readonly uri: string;
  readonly absolutePath: string;
  readonly languageId: string;
  readonly text: string;
  readonly stamp: FileStamp;
}

export interface DiagnosticsWait {
  /** Give up waiting and report what arrived. */
  readonly timeout: Temporal.Duration;
  /** When the server had reported on the previous text, how long to wait for a new report. */
  readonly grace: Temporal.Duration;
  /** How long the server must stay quiet after a report. */
  readonly quiet: Temporal.Duration;
}

export interface SessionDiagnostics {
  readonly diagnostics: readonly LspDiagnostic[];
  readonly freshness: DiagnosticsFreshness;
}

export interface ServerSessionOptions {
  /** Documents kept open; the least recently used is closed beyond this. Defaults to 64. */
  readonly maxOpenDocuments?: number;
}

interface OpenDocument {
  readonly uri: string;
  readonly absolutePath: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
  readonly lines: LineIndex;
  readonly stamp: FileStamp;
  /** Sequence number of the sync that last changed the text. */
  readonly syncedAt: number;
  /** The server had published diagnostics for the text before that change. */
  readonly hadReport: boolean;
}

const minimumWait = Temporal.Duration.from({ milliseconds: 1 });

interface Report {
  readonly diagnostics: readonly LspDiagnostic[];
  readonly version: number | undefined;
  readonly sequence: number;
  /** Measures the time since the report arrived. */
  readonly received: Stopwatch;
}

/**
 * One language server's view of the workspace: which documents are open (full-text sync from
 * disk, versioned, LRU-bounded), the latest pushed diagnostics, active work-done progress, and
 * the "wait until settled" policy for diagnostics. Knows nothing about processes or paths.
 */
export class ServerSession {
  readonly #server: LanguageServer;
  readonly #documents = new Map<string, OpenDocument>();
  readonly #reports = new Map<string, Report>();
  readonly #progress = new Set<string>();
  readonly #listeners = new Set<() => void>();
  readonly #maxOpenDocuments: number;
  #sequence = 0;
  #inFlight = 0;
  #lastActivity: Stopwatch;
  #exit: ServerExit | undefined;

  constructor(server: LanguageServer, options: ServerSessionOptions = {}) {
    this.#server = server;
    this.#maxOpenDocuments = options.maxOpenDocuments ?? 64;
    this.#lastActivity = new Stopwatch();
    server.setNotificationListener((method, params) => {
      this.#onNotification(method, params);
    });
    void this.#watchExit();
  }

  async #watchExit(): Promise<void> {
    this.#exit = await this.#server.exited;
    this.#emit();
  }

  #onNotification(method: string, params: unknown): void {
    if (typeof params !== 'object' || params === null) {
      return;
    }
    if (method === 'textDocument/publishDiagnostics' && 'uri' in params) {
      const { uri } = params;
      if (typeof uri !== 'string') {
        return;
      }
      const version =
        'version' in params && typeof params.version === 'number' ? params.version : undefined;
      const diagnostics = 'diagnostics' in params ? parseDiagnostics(params.diagnostics) : [];
      this.#sequence += 1;
      this.#reports.set(normalizeUri(uri), {
        diagnostics,
        version,
        sequence: this.#sequence,
        received: new Stopwatch(),
      });
      this.#emit();
    } else if (method === '$/progress' && 'token' in params && 'value' in params) {
      this.#onProgress(String(params.token), params.value);
    }
  }

  #onProgress(token: string, value: unknown): void {
    if (typeof value !== 'object' || value === null || !('kind' in value)) {
      return;
    }
    if (value.kind === 'begin') {
      this.#progress.add(token);
    } else if (value.kind === 'end') {
      this.#progress.delete(token);
    }
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  /** Resolves on the next publish or progress event, or after `delay`. */
  async #nextEvent(delay: Temporal.Duration): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(
        done,
        delay.round({ smallestUnit: 'millisecond', roundingMode: 'ceil' }).total('milliseconds'),
      );
      this.#listeners.add(done);
    });
  }

  #open(content: DocumentContent, key: string): SyncedDocument {
    const document: OpenDocument = {
      uri: key,
      absolutePath: content.absolutePath,
      languageId: content.languageId,
      version: 1,
      text: content.text,
      lines: new LineIndex(content.text),
      stamp: content.stamp,
      syncedAt: this.#nextSequence(),
      hadReport: false,
    };
    this.#reports.delete(key);
    this.#documents.set(key, document);
    this.#server.notify('textDocument/didOpen', {
      textDocument: { uri: key, languageId: document.languageId, version: 1, text: document.text },
    });
    for (const [uri] of this.#documents) {
      if (this.#documents.size <= this.#maxOpenDocuments) {
        break;
      }
      this.close(uri);
    }
    return syncedFrom(document, true);
  }

  #nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }

  async #track<T>(work: () => Promise<T>): Promise<T> {
    this.#inFlight += 1;
    this.#lastActivity = new Stopwatch();
    try {
      return await work();
    } finally {
      this.#inFlight -= 1;
      this.#lastActivity = new Stopwatch();
    }
  }

  async #pull(document: SyncedDocument): Promise<SessionDiagnostics | undefined> {
    const result = await this.request('textDocument/diagnostic', {
      textDocument: { uri: document.uri },
    });
    if (!result.ok || typeof result.value !== 'object' || result.value === null) {
      return undefined;
    }
    const report = result.value as Readonly<Record<string, unknown>>;
    if (report['kind'] === 'full') {
      return { diagnostics: parseDiagnostics(report['items']), freshness: 'fresh' };
    }
    return undefined;
  }

  async #waitForPush(
    document: SyncedDocument,
    wait: DiagnosticsWait,
  ): Promise<Result<SessionDiagnostics, LspError>> {
    const open = this.#documents.get(document.uri);
    const syncedAt = open?.syncedAt ?? this.#sequence;
    const hasPriorReport = open?.hadReport ?? false;
    const waited = new Stopwatch();
    for (;;) {
      if (this.#exit !== undefined) {
        return err({
          kind: 'server-exited',
          serverId: this.#server.serverId,
          exitCode: this.#exit.exitCode,
          signal: this.#exit.signal,
          restartsExhausted: false,
        });
      }
      const elapsed = waited.elapsed();
      const report = this.#reports.get(document.uri);
      const isCurrent =
        report !== undefined &&
        report.sequence > syncedAt &&
        (report.version === undefined || report.version >= document.version);
      const isBusy = this.#progress.size > 0;
      if (
        isCurrent &&
        !isBusy &&
        Temporal.Duration.compare(report.received.elapsed(), wait.quiet) >= 0
      ) {
        return ok({ diagnostics: report.diagnostics, freshness: 'fresh' });
      }
      const previous = report?.diagnostics ?? [];
      if (Temporal.Duration.compare(elapsed, wait.timeout) >= 0) {
        return ok({ diagnostics: previous, freshness: 'timed-out' });
      }
      if (
        !isCurrent &&
        hasPriorReport &&
        !isBusy &&
        Temporal.Duration.compare(elapsed, wait.grace) >= 0
      ) {
        return ok({ diagnostics: previous, freshness: 'assumed-unchanged' });
      }
      const untilDeadline = wait.timeout.subtract(elapsed);
      const untilWake = isCurrent
        ? wait.quiet.subtract(report.received.elapsed())
        : hasPriorReport
          ? wait.grace.subtract(elapsed)
          : untilDeadline;
      await this.#nextEvent(shorterOf(untilDeadline, longerOf(untilWake, minimumWait)));
    }
  }

  /** The server this session drives. */
  get server(): LanguageServer {
    return this.#server;
  }

  /** Documents currently open, least recently used first. */
  get openDocuments(): readonly {
    readonly uri: string;
    readonly absolutePath: string;
    readonly stamp: FileStamp;
  }[] {
    return Array.from(this.#documents.values(), ({ uri, absolutePath, stamp }) => {
      return {
        uri,
        absolutePath,
        stamp,
      };
    });
  }

  /** Whether a request or diagnostics wait is running. */
  get isBusy(): boolean {
    return this.#inFlight > 0;
  }

  /** Time since the last request, sync or wait finished; zero while busy. */
  get idle(): Temporal.Duration {
    if (this.isBusy) {
      return new Temporal.Duration();
    }
    return this.#lastActivity.elapsed();
  }

  /** The stamp of an open document, to decide whether it needs re-reading. */
  stampOf(uri: string): FileStamp | undefined {
    return this.#documents.get(normalizeUri(uri))?.stamp;
  }

  /** Lines of an open document, for position conversion. */
  linesOf(uri: string): LineIndex | undefined {
    return this.#documents.get(normalizeUri(uri))?.lines;
  }

  /**
   * Opens the document, or sends its new full text if it changed. With `recheck`, unchanged text
   * is sent again under a new version, which makes push-diagnostics servers re-check it against
   * dependencies that changed on disk. Marks the document most recently used.
   */
  sync(content: DocumentContent, options: { readonly recheck?: boolean } = {}): SyncedDocument {
    this.#lastActivity = new Stopwatch();
    const key = normalizeUri(content.uri);
    const existing = this.#documents.get(key);
    if (existing?.languageId !== content.languageId) {
      if (existing !== undefined) {
        this.close(key);
      }
      return this.#open(content, key);
    }
    this.#documents.delete(key);
    if (existing.text === content.text && options.recheck !== true) {
      const touched = { ...existing, stamp: content.stamp };
      this.#documents.set(key, touched);
      return syncedFrom(touched, false);
    }
    const version = existing.version + 1;
    const updated: OpenDocument = {
      ...existing,
      version,
      text: content.text,
      lines: new LineIndex(content.text),
      stamp: content.stamp,
      syncedAt: this.#nextSequence(),
      hadReport: this.#reports.has(key),
    };
    this.#documents.set(key, updated);
    this.#server.notify('textDocument/didChange', {
      textDocument: { uri: key, version },
      contentChanges: [{ text: content.text }],
    });
    return syncedFrom(updated, true);
  }

  /** Closes a document and forgets its diagnostics. */
  close(uri: string): void {
    const key = normalizeUri(uri);
    if (!this.#documents.delete(key)) {
      return;
    }

    this.#reports.delete(key);
    this.#server.notify('textDocument/didClose', { textDocument: { uri: key } });
  }

  /** Sends a request, counting it as activity for idle shutdown. */
  async request(
    method: string,
    params: unknown,
    options?: ServerRequestOptions,
  ): Promise<Result<unknown, LspError>> {
    return this.#track(async () => this.#server.request(method, params, options));
  }

  /**
   * Diagnostics for an open document once the server has settled: a pull request when the server
   * supports it, otherwise the first push report after the document's last change followed by a
   * quiet period with no work-done progress running.
   */
  async diagnostics(
    document: SyncedDocument,
    wait: DiagnosticsWait,
  ): Promise<Result<SessionDiagnostics, LspError>> {
    return this.#track(async () => {
      if (this.#server.capabilities.pullDiagnostics) {
        const pulled = await this.#pull(document);
        if (pulled !== undefined) {
          return ok(pulled);
        }
      }
      return this.#waitForPush(document, wait);
    });
  }

  /** Shuts the server down. */
  async dispose(): Promise<void> {
    this.#emit();
    await this.#server.shutdown();
  }
}

function syncedFrom(document: OpenDocument, hasChanged: boolean): SyncedDocument {
  return {
    uri: document.uri,
    absolutePath: document.absolutePath,
    version: document.version,
    lines: document.lines,
    changed: hasChanged,
  };
}

function longerOf(a: Temporal.Duration, b: Temporal.Duration): Temporal.Duration {
  if (Temporal.Duration.compare(a, b) >= 0) {
    return a;
  }
  return b;
}

function shorterOf(a: Temporal.Duration, b: Temporal.Duration): Temporal.Duration {
  if (Temporal.Duration.compare(a, b) <= 0) {
    return a;
  }
  return b;
}
