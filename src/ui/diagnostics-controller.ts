import type { ReactiveControllerHost } from 'lit';

import type { DiagnosticsRequest, DiagnosticsView, IpcResult } from '#contract/ipc-contract.ts';

import type { FileDiagnostics } from './file-diagnostics.ts';

/** The one channel the diagnostics use, which the main window's and a sheet's bridges both have. */
export interface DiagnosticsBridge {
  readonly invoke: (
    channel: 'lsp:diagnostics',
    request: DiagnosticsRequest,
  ) => Promise<IpcResult<DiagnosticsView>>;
}

/** Whose head the diagnostics are of: the session, and the commit its head is at. */
export interface DiagnosticsTarget {
  readonly sessionId: string;
  readonly headSha: string;
}

/** What the diagnostics need from the window around them. */
export interface DiagnosticsEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => DiagnosticsBridge | undefined;
  /** The head on screen, or `undefined` when there is none (no review, or a commit that is not the head). */
  readonly target: () => DiagnosticsTarget | undefined;
}

const noFiles: ReadonlyMap<string, FileDiagnostics> = new Map();
/** Questions in flight at once: a file each, so a long review does not flood the servers. */
const maxInFlight = 3;

/**
 * The language servers' diagnostics for the files on screen (ADR 0111). A card that shows a file
 * calls {@link DiagnosticsController.want}; the controller asks main once per file and head, a few
 * at a time, and keeps the answers. Answers are of the head the review showed when asked: when the
 * head moves, or the servers restart ({@link DiagnosticsController.reset}), they are forgotten and
 * the cards ask again. An answer that arrives after that is dropped. The host re-renders when
 * {@link DiagnosticsController.byPath} changes.
 */
export class DiagnosticsController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: DiagnosticsEnvironment;
  /** The session and head the kept answers are for. */
  private scope = '';
  private files: ReadonlyMap<string, FileDiagnostics> = noFiles;
  private queue: string[] = [];
  private inFlight = 0;
  /** Bumped by everything that makes an answer in flight stale. */
  private generation = 0;

  constructor(host: ReactiveControllerHost, environment: DiagnosticsEnvironment) {
    this.host = host;
    this.environment = environment;
  }

  private scopeNow(): string | undefined {
    const target = this.environment.target();
    if (target === undefined) {
      return undefined;
    }
    return `${target.sessionId}\0${target.headSha}`;
  }

  private begin(scope: string): void {
    this.generation += 1;
    this.scope = scope;
    this.files = new Map();
    this.queue = [];
  }

  private patch(path: string, value: FileDiagnostics): void {
    this.files = new Map(this.files).set(path, value);
    this.host.requestUpdate();
  }

  private pump(): void {
    while (this.inFlight < maxInFlight) {
      const path = this.queue.shift();
      if (path === undefined) {
        return;
      }
      void this.ask(path);
    }
  }

  private async ask(path: string): Promise<void> {
    const { generation } = this;
    const bridge = this.environment.bridge();
    const target = this.environment.target();
    if (bridge === undefined || target === undefined) {
      this.patch(path, { kind: 'failed' });
      return;
    }
    this.inFlight += 1;
    try {
      const answer = await bridge.invoke('lsp:diagnostics', {
        sessionId: target.sessionId,
        sha: target.headSha,
        path,
      });
      if (generation === this.generation) {
        if (answer.ok) {
          this.patch(path, { kind: 'ready', view: answer.value });
        } else {
          this.patch(path, { kind: 'failed' });
        }
      }
    } finally {
      this.inFlight -= 1;
      this.pump();
    }
  }

  /** What is known per repository-relative path, for the head the review shows now. */
  get byPath(): ReadonlyMap<string, FileDiagnostics> {
    if (this.scopeNow() === this.scope) {
      return this.files;
    }
    return noFiles;
  }

  /** A card shows `path`: asks for its diagnostics unless they are known or on the way. */
  want(path: string): void {
    const scope = this.scopeNow();
    if (scope === undefined) {
      return;
    }
    if (scope !== this.scope) {
      this.begin(scope);
    }
    if (this.files.has(path)) {
      return;
    }
    this.patch(path, { kind: 'checking' });
    this.queue.push(path);
    this.pump();
  }

  /** Forgets every answer, as when the language servers restart; the cards ask again. */
  reset(): void {
    this.begin(this.scopeNow() ?? '');
    this.host.requestUpdate();
  }
}
