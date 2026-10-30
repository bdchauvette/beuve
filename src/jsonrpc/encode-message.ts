import { Buffer } from 'node:buffer';

import type { JsonRpcMessage } from './json-rpc-message.ts';

/** Serializes `message` as JSON with a `Content-Length` header counting UTF-8 bytes. */
export function encodeMessage(message: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${String(body.byteLength)}\r\n\r\n`, 'latin1');
  return Buffer.concat([header, body]);
}
