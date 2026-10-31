import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { JsonRpcErrorObject, JsonRpcId, ParsedJsonRpcMessage } from './json-rpc-message.ts';

/** Parses one frame body and classifies it as a request, notification or response. */
export function parseMessage(body: string): Result<ParsedJsonRpcMessage, string> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error: unknown) {
    return err(`invalid JSON: ${errorFrom(error).message}`);
  }
  if (!isRecord(value) || value['jsonrpc'] !== '2.0') {
    return err('not a JSON-RPC 2.0 object');
  }
  const { id, method, params } = value;
  if (params !== undefined && (typeof params !== 'object' || params === null)) {
    return err('params must be an object or an array');
  }
  if (typeof method === 'string') {
    if (id === undefined) {
      return ok({ kind: 'notification', message: { jsonrpc: '2.0', method, params } });
    }
    if (isId(id)) {
      return ok({ kind: 'request', message: { jsonrpc: '2.0', id, method, params } });
    }
    return err('request id must be a number or a string');
  }
  if (id !== null && !isId(id)) {
    return err('response id must be a number, a string or null');
  }
  if ('result' in value && !('error' in value)) {
    return ok({ kind: 'response', message: { jsonrpc: '2.0', id, result: value['result'] } });
  }
  const { error } = value;
  if (isErrorObject(error) && !('result' in value)) {
    return ok({ kind: 'response', message: { jsonrpc: '2.0', id, error } });
  }
  return err('response must carry exactly one of result or a well-formed error');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isErrorObject(value: unknown): value is JsonRpcErrorObject {
  return (
    isRecord(value) && Number.isSafeInteger(value['code']) && typeof value['message'] === 'string'
  );
}
