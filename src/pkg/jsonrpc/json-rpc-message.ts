/** A JSON-RPC 2.0 request id. `null` appears only in error responses to unparseable requests. */
export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

/** The `error` member of a failed response. */
export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId | null;
  readonly result: unknown;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId | null;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Any message on a JSON-RPC 2.0 connection, as it appears on the wire. */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** A received message, classified by shape. */
export type ParsedJsonRpcMessage =
  | { readonly kind: 'request'; readonly message: JsonRpcRequest }
  | { readonly kind: 'notification'; readonly message: JsonRpcNotification }
  | { readonly kind: 'response'; readonly message: JsonRpcResponse };
