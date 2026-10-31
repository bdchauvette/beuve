import type { ModelError } from './language-model.ts';

/**
 * The {@link ModelError} for a failed OpenAI-compatible response (ADR 0071): 401 and 403 are
 * `not-authenticated`, 429 is `rate-limited` (with `retry-after` seconds as `resetsAt`), anything
 * else `model-failed` with the status. The message is the body's `error.message`, its `error`
 * string (Ollama's shape) or the raw body, cut to 1000 characters.
 */
export function openAiErrorFrom(status: number, body: string, headers: Headers): ModelError {
  const message = messageFrom(body, status);
  if (status === 401 || status === 403) {
    return { kind: 'not-authenticated', message };
  }
  if (status === 429) {
    return { kind: 'rate-limited', message, resetsAt: resetTime(headers.get('retry-after')) };
  }
  return { kind: 'model-failed', reason: `http-${String(status)}`, message, status };
}

function messageFrom(body: string, status: number): string {
  let text = body.trim();
  try {
    const error = errorFieldOf(JSON.parse(body) as unknown);
    if (typeof error === 'string') {
      text = error;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      text = String(error.message);
    }
  } catch {
    // Not JSON: the body as it is.
  }
  if (text === '') {
    return `HTTP ${String(status)}`;
  }
  return text.slice(0, 1000);
}

/** When `retry-after` gives a whole number of seconds, the instant it points at. */
function resetTime(retryAfter: string | null): string | undefined {
  const seconds = Number(retryAfter ?? '');
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return undefined;
  }
  return Temporal.Now.instant().add({ seconds }).toString({ fractionalSecondDigits: 3 });
}

function errorFieldOf(json: unknown): unknown {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    return json.error;
  }
  return undefined;
}
