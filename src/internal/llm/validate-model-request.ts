import path from 'node:path';

import type { BaseModelRequest, ModelError } from './language-model.ts';

/** Linux caps one argv string at 128 KiB; Claude Code's system prompt and schema are arguments. */
const maxArgumentChars = 100_000;

/**
 * Why a request can't be sent, or `undefined`: `cwd`, when given, must be absolute, the conversation must end
 * with a user turn, no field may hold a NUL byte, the system prompt plus `schemaChars` of JSON
 * Schema must fit one argument (Claude Code's limit), and the timeout must be positive.
 */
export function validateModelRequest(
  request: BaseModelRequest,
  schemaChars: number,
): ModelError | undefined {
  if (request.cwd !== undefined && !path.isAbsolute(request.cwd)) {
    return { kind: 'invalid-request', reason: 'cwd must be absolute' };
  }
  if (request.messages.length === 0 || request.messages.at(-1)?.role !== 'user') {
    return { kind: 'invalid-request', reason: 'the last message must be the user turn' };
  }
  const texts = [
    request.cwd ?? '',
    request.system,
    ...request.messages.map((message) => message.content),
  ];
  if (texts.some((text) => text.includes('\0'))) {
    return { kind: 'invalid-request', reason: 'the request contains a NUL byte' };
  }
  if (request.system.length + schemaChars > maxArgumentChars) {
    return { kind: 'invalid-request', reason: 'the system prompt and schema are too long' };
  }
  if (request.timeout.sign <= 0) {
    return { kind: 'invalid-request', reason: 'timeout must be positive' };
  }
  return undefined;
}
