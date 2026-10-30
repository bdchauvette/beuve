import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ModelError } from './language-model.ts';
import { openAiErrorFrom } from './open-ai-error-from.ts';

export interface ListModelsOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeout: Temporal.Duration;
  readonly fetch?: typeof fetch;
}

const modelShape = z.looseObject({ id: z.string() });

const modelList = z.looseObject({ data: z.array(modelShape) });

const trailingSlashes = /\/+$/u;

/**
 * The model ids an OpenAI-compatible server lists at `GET {baseUrl}/models` (ADR 0071), sorted.
 * A server without the endpoint answers `model-failed` with status 404; the caller then lets
 * the user type the id.
 */
export async function listOpenAiCompatibleModels(
  options: ListModelsOptions,
): Promise<Result<string[], ModelError>> {
  const url = `${options.baseUrl.replace(trailingSlashes, '')}/models`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: {
        accept: 'application/json',
        ...(options.apiKey !== undefined &&
          options.apiKey !== '' && {
            authorization: `Bearer ${options.apiKey}`,
          }),
      },
      signal: AbortSignal.timeout(options.timeout.total('milliseconds')),
      redirect: 'error',
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return err({ kind: 'timeout', timeout: options.timeout });
    }
    return err({
      kind: 'model-failed',
      reason: 'unreachable',
      message: `Could not reach ${url}. Is the server running?`,
    });
  }
  let text = '';
  try {
    text = await response.text();
  } catch {
    // An unreadable body reads as empty.
  }
  if (!response.ok) {
    return err(openAiErrorFrom(response.status, text.slice(0, 4000), response.headers));
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ kind: 'invalid-output', reason: 'the model list is not JSON' });
  }
  const parsed = modelList.safeParse(json);
  return parsed.success
    ? ok(
        parsed.data.data
          .map((model) => model.id)
          .toSorted((left, right) => left.localeCompare(right, 'en')),
      )
    : err({ kind: 'invalid-output', reason: 'the model list has no data array' });
}
