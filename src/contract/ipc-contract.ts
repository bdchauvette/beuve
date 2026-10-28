import type { Result } from '#pkg/result/result.ts';

/**
 * The typed IPC contract between main, preload and ui (ADR 0011). Plain serializable data
 * only: everything here crosses a structured-clone boundary and must stay DOM- and Node-free.
 */

/** Static facts about the running app, for the status bar and diagnostics. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
}

/** What a session reviews: a local branch or a GitHub pull request. */
export type SessionSourceView =
  | {
      readonly kind: 'local';
      readonly repoPath: string;
      readonly baseRef: string;
      readonly headRef: string;
    }
  | {
      readonly kind: 'github-pull-request';
      readonly repoPath: string;
      readonly baseRef: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    };

/**
 * A review session as the UI sees it: the session domain's model flattened to plain strings.
 * `lastReviewedSha` is absent until the first checkpoint. Timestamps are ISO-8601 UTC.
 */
export interface SessionSummary {
  readonly id: string;
  readonly source: SessionSourceView;
  readonly headSha: string;
  readonly lastReviewedSha?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OpenSessionRequest {
  readonly sessionId: string;
}

/** Expected failures of an invoke channel. `not-wired` means the backing service isn't composed yet. */
export type IpcErrorCode = 'invalid-request' | 'not-wired' | 'not-found' | 'internal';

export interface IpcError {
  readonly code: IpcErrorCode;
  readonly message: string;
}

/** Every invoke response is a `Result`, so expected failures never surface as rejected promises. */
export type IpcResult<T> = Result<T, IpcError>;

/** Request/response pairs for `ipcRenderer.invoke` channels. */
export interface InvokeChannelMap {
  'app:get-info': { readonly request: undefined; readonly response: IpcResult<AppInfo> };
  'session:list': {
    readonly request: undefined;
    readonly response: IpcResult<readonly SessionSummary[]>;
  };
  'session:open': {
    readonly request: OpenSessionRequest;
    readonly response: IpcResult<SessionSummary>;
  };
}

export type InvokeChannel = keyof InvokeChannelMap;
export type InvokeRequest<C extends InvokeChannel> = InvokeChannelMap[C]['request'];
export type InvokeResponse<C extends InvokeChannel> = InvokeChannelMap[C]['response'];

/** State of the embedded MCP server. The bearer token never crosses into the renderer. */
export type McpStatus =
  | { readonly state: 'starting' }
  | { readonly state: 'running'; readonly url: string }
  | { readonly state: 'stopped' }
  | { readonly state: 'failed'; readonly message: string };

/** Payloads main pushes to the renderer with `webContents.send`. */
export interface EventChannelMap {
  'mcp:status': McpStatus;
}

export type EventChannel = keyof EventChannelMap;
export type EventPayload<E extends EventChannel> = EventChannelMap[E];

/** Unsubscribes a listener registered with {@link BeuveApi.on}. */
export type Unsubscribe = () => void;

/** The API the preload exposes as `window.beuve`. */
export interface BeuveApi {
  readonly invoke: <C extends InvokeChannel>(
    channel: C,
    ...request: InvokeRequest<C> extends undefined ? [] : [InvokeRequest<C>]
  ) => Promise<InvokeResponse<C>>;
  readonly on: <E extends EventChannel>(
    channel: E,
    listener: (payload: EventPayload<E>) => void,
  ) => Unsubscribe;
}
