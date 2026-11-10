/**
 * The kinds of request a newer one of the same kind, from the same window, supersedes (ADR 0079).
 * A window shows one review and one sheet file at a time, so only its latest load of each is
 * wanted, whichever session it is for. A `note-draft` is superseded only by one with the same
 * `requestId`: the renderer names a note's drafting requests by the note (ADR 0125).
 */
export type SupersededKind =
  | 'review'
  | 'order'
  | 'tree'
  | 'file-attributes'
  | 'sheet-file'
  | 'sheet-head'
  | 'open-pull-request'
  | 'note-draft';

/** One request's cancellation. Disposing it when the request ends forgets it. */
export interface RequestScope extends Disposable {
  readonly signal: AbortSignal;
}

interface Entry {
  readonly controller: AbortController;
  readonly window: number;
  readonly key: string;
  readonly requestId: string | undefined;
}

/**
 * Main's cancellation of renderer requests (ADR 0079). AbortSignals can't cross IPC, so a request
 * is cancelled here when a newer one of its kind from the same window arrives, when the renderer
 * names its `requestId` in `request:cancel`, or when its window closes. Each request's signal
 * reaches its git processes through the services it calls.
 */
export class RequestScopes {
  readonly #latest = new Map<string, Entry>();
  readonly #entries = new Set<Entry>();

  /** Starts a request of `kind` from `window`, aborting the window's previous one of that kind. */
  begin(window: number, kind: SupersededKind, requestId?: string): RequestScope {
    let key = `${String(window)}\0${kind}`;
    if (kind === 'note-draft') {
      key += `\0${requestId ?? ''}`;
    }
    this.#latest.get(key)?.controller.abort(new DOMException('superseded', 'AbortError'));
    const entry: Entry = { controller: new AbortController(), window, key, requestId };
    this.#latest.set(key, entry);
    this.#entries.add(entry);
    return {
      signal: entry.controller.signal,
      [Symbol.dispose]: (): void => {
        this.#entries.delete(entry);
        if (this.#latest.get(key) === entry) {
          this.#latest.delete(key);
        }
      },
    };
  }

  /** Cancels `window`'s requests with `requestId`; false when none is outstanding. */
  cancel(window: number, requestId: string): boolean {
    let isCancelled = false;
    for (const entry of this.#entries) {
      if (entry.window !== window || entry.requestId !== requestId) {
        continue;
      }
      entry.controller.abort(new DOMException('cancelled', 'AbortError'));
      isCancelled = true;
    }
    return isCancelled;
  }

  /** Aborts everything `window` still has outstanding; its answers would go nowhere. */
  closeWindow(window: number): void {
    for (const entry of this.#entries) {
      if (entry.window === window) {
        entry.controller.abort(new DOMException('window closed', 'AbortError'));
      }
    }
  }
}
