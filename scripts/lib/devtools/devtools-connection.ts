import { setTimeout as delay } from 'node:timers/promises';

/** An event the browser sends unprompted, on a page's session or on the browser's own. */
export interface DevtoolsEvent {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly sessionId?: string;
}

/** A page target, attached and paused until the `onPage` callback of {@link DevtoolsConnection.open} returns. */
export interface DevtoolsPage {
  readonly sessionId: string;
  readonly url: string;
}

interface Pending {
  readonly method: string;
  readonly resolve: (result: Readonly<Record<string, unknown>>) => void;
  readonly reject: (error: Error) => void;
}

interface TargetInfo {
  readonly targetId: string;
  readonly type: string;
  readonly url: string;
}

/** How often {@link DevtoolsConnection.waitFor} re-evaluates its expression, in milliseconds. */
const pollMilliseconds = 150;

/**
 * One Chrome DevTools Protocol connection to a browser (Electron's renderer processes), with
 * flattened sessions. Every page is attached as it opens and held before its first script until
 * `onPage` has prepared it, so a listener installed there sees everything the page does.
 */
export class DevtoolsConnection implements Disposable {
  /** Connects to `browserUrl` (`ws://…/devtools/browser/…`) and attaches to every page. */
  static async open(
    browserUrl: string,
    onPage: (page: DevtoolsPage, connection: DevtoolsConnection) => Promise<void>,
  ): Promise<DevtoolsConnection> {
    const socket = new WebSocket(browserUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`cannot connect to ${browserUrl}`));
      });
    });
    const connection = new DevtoolsConnection(socket);
    socket.addEventListener('message', (message) => {
      connection.#receive(String(message.data), onPage);
    });
    await connection.send('Target.setDiscoverTargets', { discover: true });
    await connection.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    return connection;
  }

  readonly #socket: WebSocket;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners: ((event: DevtoolsEvent) => void)[] = [];
  /** Attached page sessions and their targets, as last reported. */
  readonly #pages = new Map<string, TargetInfo>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  #receive(
    data: string,
    onPage: (page: DevtoolsPage, connection: DevtoolsConnection) => Promise<void>,
  ): void {
    const message = JSON.parse(data) as {
      readonly id?: number;
      readonly result?: Readonly<Record<string, unknown>>;
      readonly error?: { readonly message: string };
    } & Partial<DevtoolsEvent>;
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error === undefined) {
        pending?.resolve(message.result ?? {});
      } else {
        pending?.reject(new Error(`${pending.method}: ${message.error.message}`));
      }
      return;
    }
    const event: DevtoolsEvent = {
      method: message.method ?? '',
      params: message.params ?? {},
      ...(message.sessionId !== undefined && { sessionId: message.sessionId }),
    };
    if (event.method === 'Target.attachedToTarget') {
      this.#attach(event, onPage);
    }
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  async #sendIgnoringResult(
    method: string,
    params: Readonly<Record<string, unknown>>,
    sessionId: string | undefined,
  ): Promise<void> {
    try {
      await this.send(method, params, sessionId);
    } catch {
      // Nobody waits for this result.
    }
  }

  async #evaluateOrUndefined(sessionId: string, expression: string): Promise<unknown> {
    try {
      return await this.evaluate(sessionId, expression);
    } catch {
      return undefined;
    }
  }

  /** Prepares an attached page with `onPage`, then lets it run. Other targets just run. */
  #attach(
    event: DevtoolsEvent,
    onPage: (page: DevtoolsPage, connection: DevtoolsConnection) => Promise<void>,
  ): void {
    const sessionId = event.params['sessionId'] as string;
    const info = event.params['targetInfo'] as TargetInfo;
    const prepare = async (): Promise<void> => {
      try {
        if (info.type === 'page') {
          this.#pages.set(sessionId, info);
          await onPage({ sessionId, url: info.url }, this);
        }
      } catch (error) {
        console.error(`preparing ${info.url} failed:`, error);
      } finally {
        this.post('Runtime.runIfWaitingForDebugger', {}, sessionId);
      }
    };
    void prepare();
  }

  /** Sends a command, to a page when `sessionId` is given, and resolves with its result. */
  async send(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { method, resolve, reject });
      this.#socket.send(
        JSON.stringify({ id, method, params, ...(sessionId !== undefined && { sessionId }) }),
      );
    });
  }

  /**
   * Sends a command without waiting for its result, which is ignored: for a page held before its
   * first script, which answers `Page.*` only once it runs. A session applies commands in order.
   */
  post(method: string, params: Readonly<Record<string, unknown>> = {}, sessionId?: string): void {
    void this.#sendIgnoringResult(method, params, sessionId);
  }

  /** Calls `listener` with every event from now on. */
  on(listener: (event: DevtoolsEvent) => void): void {
    this.#listeners.push(listener);
  }

  /** The URL of the page attached as `sessionId`, as last reported. */
  urlOf(sessionId: string): string {
    return this.#pages.get(sessionId)?.url ?? '';
  }

  /** Evaluates `expression` in a page, awaiting a promise, and returns its value as JSON. */
  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId,
    );
    const details = result['exceptionDetails'] as
      | { readonly text?: string; readonly exception?: { readonly description?: string } }
      | undefined;
    if (details !== undefined) {
      throw new Error(`evaluate: ${details.exception?.description ?? details.text ?? 'threw'}`);
    }
    return (result['result'] as { readonly value?: unknown } | undefined)?.value;
  }

  /** Re-evaluates `expression` until it is truthy and returns that value; rejects when `signal` aborts. */
  async waitFor(sessionId: string, expression: string, signal: AbortSignal): Promise<unknown> {
    for (;;) {
      const value = await this.#evaluateOrUndefined(sessionId, expression);
      if (!falsy.has(value)) {
        return value;
      }
      await delay(pollMilliseconds, undefined, { signal });
    }
  }

  /** The session of the first page whose URL `isWanted`, once one is attached; rejects when `signal` aborts. */
  async waitForPage(isWanted: (url: string) => boolean, signal: AbortSignal): Promise<string> {
    for (;;) {
      const { targetInfos } = (await this.send('Target.getTargets')) as {
        readonly targetInfos: readonly TargetInfo[];
      };
      for (const [sessionId, known] of this.#pages) {
        const info = targetInfos.find((target) => target.targetId === known.targetId);
        if (info !== undefined) {
          this.#pages.set(sessionId, info);
        }
      }
      const found = [...this.#pages].find(([, info]) => isWanted(info.url));
      if (found !== undefined) {
        return found[0];
      }
      await delay(pollMilliseconds, undefined, { signal });
    }
  }

  [Symbol.dispose](): void {
    this.#socket.close();
  }
}

/** Values `waitFor` keeps waiting on: JSON's falsy values, and no value. */
// eslint-disable-next-line unicorn/no-null -- a page's JSON result can be null.
const falsy: ReadonlySet<unknown> = new Set([undefined, null, false, 0, '']);
