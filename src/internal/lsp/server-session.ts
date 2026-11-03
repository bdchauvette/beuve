import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import { LineIndex } from './line-index.ts';
import type { LspError } from './lsp-error.ts';
import { normalizeUri } from './normalize-uri.ts';
import type { LanguageServer, ServerRequestOptions } from './start-language-server.ts';

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
}

/**
 * One language server's view of the workspace: which documents are open (full-text sync from
 * disk, versioned, LRU-bounded) and when it last did work. Knows nothing about processes or paths.
 */
export class ServerSession {
  readonly #server: LanguageServer;
  readonly #documents = new Map<string, OpenDocument>();
  readonly #maxOpenDocuments: number;
  #inFlight = 0;
  #lastActivity: Stopwatch;

  constructor(server: LanguageServer, options: ServerSessionOptions = {}) {
    this.#server = server;
    this.#maxOpenDocuments = options.maxOpenDocuments ?? 64;
    this.#lastActivity = new Stopwatch();
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
    };
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

  /** The server this session drives. */
  get server(): LanguageServer {
    return this.#server;
  }

  /** Documents currently open, least recently used first. */
  get openDocuments(): readonly Pick<DocumentContent, 'uri' | 'absolutePath' | 'stamp'>[] {
    return Array.from(this.#documents.values(), ({ uri, absolutePath, stamp }) => {
      return {
        uri,
        absolutePath,
        stamp,
      };
    });
  }

  /** Whether a request is running. */
  get isBusy(): boolean {
    return this.#inFlight > 0;
  }

  /** Time since the last request or sync finished; zero while busy. */
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
   * Opens the document, or sends its new full text if it changed. Marks the document most
   * recently used.
   */
  sync(content: DocumentContent): SyncedDocument {
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
    if (existing.text === content.text) {
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
    };
    this.#documents.set(key, updated);
    this.#server.notify('textDocument/didChange', {
      textDocument: { uri: key, version },
      contentChanges: [{ text: content.text }],
    });
    return syncedFrom(updated, true);
  }

  /** Closes a document. */
  close(uri: string): void {
    const key = normalizeUri(uri);
    if (!this.#documents.delete(key)) {
      return;
    }
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

  /** Shuts the server down. */
  async dispose(): Promise<void> {
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
