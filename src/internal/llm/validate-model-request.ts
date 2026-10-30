import path from 'node:path';

import type { BaseModelRequest, ModelError } from './language-model.ts';

/** Linux caps one argv string at 128 KiB; the system prompt and schema travel as arguments. */
const maxArgumentChars = 100_000;

/**
 * Why a request can't be sent to Claude Code, or `undefined`: `cwd` must be absolute, no field may
 * hold a NUL byte, the system prompt plus `schemaChars` of JSON Schema must fit one argument, and
 * the timeout must be positive.
 */
export function validateModelRequest(
  request: BaseModelRequest,
  schemaChars: number,
): ModelError | undefined {
  if (!path.isAbsolute(request.cwd)) {
    return { kind: 'invalid-request', reason: 'cwd must be absolute' };
  }
  if ([request.cwd, request.system, request.prompt].some((text) => text.includes('\0'))) {
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
