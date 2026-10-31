import type { Readable, Writable } from 'node:stream';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { ContentLengthDecoder } from './content-length-decoder.ts';
import type { FramingError } from './content-length-decoder.ts';
import { encodeMessage } from './encode-message.ts';
import type {
  JsonRpcErrorObject,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './json-rpc-message.ts';
import { parseMessage } from './parse-message.ts';

/** Why an outgoing request produced no result. */
export type JsonRpcRequestError =
  | { readonly kind: 'timeout'; readonly method: string; readonly timeout: Temporal.Duration }
  | { readonly kind: 'cancelled'; readonly method: string }
  | { readonly kind: 'closed'; readonly method: string }
  | {
      readonly kind: 'remote-error';
      readonly method: string;
      readonly code: number;
      readonly message: string;
      readonly data: unknown;
    };

/** Why the connection stopped. */
export type JsonRpcCloseReason =
  | { readonly kind: 'closed-locally' }
  | { readonly kind: 'input-ended' }
  | { readonly kind: 'stream-error'; readonly message: string }
  | { readonly kind: 'framing-error'; readonly error: FramingError };

/** What a handler answers to a request from the peer. */
export type JsonRpcHandlerOutcome = Result<unknown, JsonRpcErrorObject>;

export interface JsonRpcConnectionOptions {
  /** Bytes from the peer (e.g. a child's stdout). */
  readonly input: Readable;
  /** Bytes to the peer (e.g. a child's stdin). */
  readonly output: Writable;
  /** Answers requests the peer sends. Without one, every request gets "method not found". */
  readonly onRequest?: (
    method: string,
    params: unknown,
    signal: AbortSignal,
  ) => JsonRpcHandlerOutcome | Promise<JsonRpcHandlerOutcome>;
  readonly onNotification?: (method: string, params: unknown) => void;
  readonly onClose?: (reason: JsonRpcCloseReason) => void;
  /**
   * Notification sent with `{ id }` when an outgoing request times out or is aborted, and
   * honoured for incoming requests (`$/cancelRequest` in LSP). Without one, nothing is sent.
   */
  readonly cancelMethod?: string;
  /** Applies to requests that don't pass their own. Defaults to 30 s. */
  readonly defaultTimeout?: Temporal.Duration;
  readonly maxMessageBytes?: number;
  readonly logger?: Logger;
}

export interface JsonRpcRequestOptions {
  readonly timeout?: Temporal.Duration;
  readonly signal?: AbortSignal | undefined;
}

interface PendingRequest {
  readonly method: string;
  readonly settle: (outcome: Result<unknown, JsonRpcRequestError>) => void;
}

const methodNotFound = -32_601;
const internalError = -32_603;
const requestCancelled = -32_800;

/**
 * A JSON-RPC 2.0 peer over a pair of byte streams with `Content-Length` framing. Correlates
 * responses with requests, applies timeouts and cancellation, dispatches the peer's requests and
 * notifications, and settles everything still pending once the connection closes. It never owns
 * the streams' lifetime and never rejects: failures are `Result`s.
 */
export class JsonRpcConnection {
  readonly #options: JsonRpcConnectionOptions;
  readonly #decoder: ContentLengthDecoder;
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  readonly #incoming = new Map<JsonRpcId, AbortController>();
  readonly #detach: () => void;
  #nextId = 1;
  #closeReason: JsonRpcCloseReason | undefined;

  constructor(options: JsonRpcConnectionOptions) {
    this.#options = options;
    this.#decoder = new ContentLengthDecoder({
      ...(options.maxMessageBytes !== undefined && { maxMessageBytes: options.maxMessageBytes }),
    });
    const { input, output } = options;
    const onData = (chunk: Uint8Array | string): void => {
      if (typeof chunk === 'string') {
        this.#receive(new TextEncoder().encode(chunk));
      } else {
        this.#receive(chunk);
      }
    };
    const onEnd = (): void => {
      this.#close({ kind: 'input-ended' });
    };
    const onError = (error: Error): void => {
      this.#close({ kind: 'stream-error', message: error.message });
    };
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('close', onEnd);
    input.on('error', onError);
    output.on('error', onError);
    output.on('close', onEnd);
    this.#detach = (): void => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('close', onEnd);
      output.off('close', onEnd);
    };
  }

  #receive(chunk: Uint8Array): void {
    const bodies = this.#decoder.push(chunk);
    if (!bodies.ok) {
      this.#close({ kind: 'framing-error', error: bodies.error });
      return;
    }
    for (const body of bodies.value) {
      if (this.#closeReason !== undefined) {
        return;
      }
      this.#dispatch(body);
    }
  }

  #dispatch(body: string): void {
    const parsed = parseMessage(body);
    if (!parsed.ok) {
      this.#options.logger?.warn('jsonrpc: dropping malformed message', { reason: parsed.error });
      return;
    }
    switch (parsed.value.kind) {
      case 'response': {
        this.#handleResponse(parsed.value.message);
        return;
      }
      case 'notification': {
        this.#handleNotification(parsed.value.message);
        return;
      }
      case 'request': {
        void this.#handleRequest(parsed.value.message);
        return;
      }
    }
  }

  #pendingFor(id: JsonRpcId | null): PendingRequest | undefined {
    if (id === null) {
      return undefined;
    }
    return this.#pending.get(id);
  }

  #handleResponse(response: JsonRpcResponse): void {
    const pending = this.#pendingFor(response.id);
    if (pending === undefined) {
      this.#options.logger?.debug('jsonrpc: response for unknown request', { id: response.id });
      return;
    }
    if ('error' in response) {
      const { code, message, data } = response.error;
      pending.settle(err({ kind: 'remote-error', method: pending.method, code, message, data }));
    } else {
      pending.settle(ok(response.result));
    }
  }

  #handleNotification(notification: JsonRpcNotification): void {
    const { cancelMethod } = this.#options;
    if (cancelMethod !== undefined && notification.method === cancelMethod) {
      const id = readCancelledId(notification.params);
      if (id !== undefined) {
        this.#incoming.get(id)?.abort();
      }
      return;
    }
    try {
      this.#options.onNotification?.(notification.method, notification.params);
    } catch (error: unknown) {
      this.#options.logger?.error('jsonrpc: notification handler threw', {
        method: notification.method,
        error,
      });
    }
  }

  async #handleRequest(request: JsonRpcRequest): Promise<void> {
    const { onRequest } = this.#options;
    if (onRequest === undefined) {
      this.#respond(
        request.id,
        err({ code: methodNotFound, message: `Unhandled method ${request.method}` }),
      );
      return;
    }
    const controller = new AbortController();
    this.#incoming.set(request.id, controller);
    const cancelled = new Promise<JsonRpcHandlerOutcome>((resolve) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          resolve(err({ code: requestCancelled, message: 'Request cancelled' }));
        },
        { once: true },
      );
    });
    let outcome: JsonRpcHandlerOutcome;
    try {
      outcome = await Promise.race([
        Promise.resolve(onRequest(request.method, request.params, controller.signal)),
        cancelled,
      ]);
    } catch (error: unknown) {
      this.#options.logger?.error('jsonrpc: request handler threw', {
        method: request.method,
        error,
      });
      outcome = err({ code: internalError, message: 'Internal error' });
    } finally {
      this.#incoming.delete(request.id);
    }
    this.#respond(request.id, outcome);
  }

  #respond(id: JsonRpcId, outcome: JsonRpcHandlerOutcome): void {
    if (outcome.ok) {
      // eslint-disable-next-line unicorn/no-null -- a JSON-RPC success must carry `result`.
      this.#write({ jsonrpc: '2.0', id, result: outcome.value ?? null });
    } else {
      this.#write({ jsonrpc: '2.0', id, error: outcome.error });
    }
  }

  #sendCancel(id: JsonRpcId): void {
    const { cancelMethod } = this.#options;
    if (cancelMethod !== undefined) {
      this.notify(cancelMethod, { id });
    }
  }

  #write(message: JsonRpcMessage): boolean {
    const { output } = this.#options;
    if (this.#closeReason !== undefined || output.destroyed || output.writableEnded) {
      return false;
    }
    output.write(encodeMessage(message));
    return true;
  }

  #close(reason: JsonRpcCloseReason): void {
    if (this.#closeReason !== undefined) {
      return;
    }
    this.#closeReason = reason;
    this.#detach();
    for (const controller of this.#incoming.values()) {
      controller.abort();
    }
    for (const pending of this.#pending.values()) {
      pending.settle(err({ kind: 'closed', method: pending.method }));
    }
    try {
      this.#options.onClose?.(reason);
    } catch (error: unknown) {
      this.#options.logger?.error('jsonrpc: close handler threw', { error });
    }
  }

  /** Why the connection closed, or `undefined` while it is open. */
  get closeReason(): JsonRpcCloseReason | undefined {
    return this.#closeReason;
  }

  /** Outgoing requests still awaiting a response. */
  get pendingRequests(): number {
    return this.#pending.size;
  }

  /** Sends a request and settles with its result, a remote error, a timeout or cancellation. */
  async request(
    method: string,
    params: unknown,
    options: JsonRpcRequestOptions = {},
  ): Promise<Result<unknown, JsonRpcRequestError>> {
    if (this.#closeReason !== undefined) {
      return err({ kind: 'closed', method });
    }
    if (options.signal?.aborted === true) {
      return err({ kind: 'cancelled', method });
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const timeout =
      options.timeout ?? this.#options.defaultTimeout ?? Temporal.Duration.from({ seconds: 30 });
    const deadline = timeoutSignal(timeout);
    let stopped = deadline;
    if (options.signal !== undefined) {
      stopped = AbortSignal.any([options.signal, deadline]);
    }
    const listeners = new AbortController();
    return new Promise((resolve) => {
      const settle = (outcome: Result<unknown, JsonRpcRequestError>): void => {
        listeners.abort();
        this.#pending.delete(id);
        resolve(outcome);
      };
      stopped.addEventListener(
        'abort',
        () => {
          if (!this.#pending.has(id)) {
            return;
          }
          if (stopped.reason === deadline.reason) {
            settle(err({ kind: 'timeout', method, timeout }));
          } else {
            settle(err({ kind: 'cancelled', method }));
          }
          this.#sendCancel(id);
        },
        { once: true, signal: listeners.signal },
      );
      this.#pending.set(id, { method, settle });
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined && { params }),
      };
      if (!this.#write(request)) {
        settle(err({ kind: 'closed', method }));
      }
    });
  }

  /** Sends a notification; fails only when the connection is closed. */
  notify(method: string, params?: unknown): Result<undefined, JsonRpcRequestError> {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined && { params }),
    };
    if (this.#write(notification)) {
      return ok(undefined);
    }
    return err({ kind: 'closed', method });
  }

  /**
   * Stops reading and settles pending requests as `closed`. The streams are left to their owner;
   * error listeners stay attached so a late `EPIPE` can't become an uncaught exception.
   */
  close(): void {
    this.#close({ kind: 'closed-locally' });
  }
}

function readCancelledId(params: unknown): JsonRpcId | undefined {
  if (typeof params !== 'object' || params === null || !('id' in params)) {
    return undefined;
  }
  const { id } = params;
  if (typeof id === 'number' || typeof id === 'string') {
    return id;
  }
  return undefined;
}
