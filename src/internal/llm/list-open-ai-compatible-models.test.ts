import { describe } from 'vitest';

import { listOpenAiCompatibleModels } from './list-open-ai-compatible-models.ts';
import { test } from './testing/test.ts';

function fiveSeconds(): Temporal.Duration {
  return Temporal.Duration.from({ seconds: 5 });
}

describe('listOpenAiCompatibleModels', () => {
  test('lists the ids from GET /models, sorted, sending the key', async ({ expect, openAiApi }) => {
    const api = await openAiApi({ models: ['qwen3:8b', 'llama3.2:3b'] });
    await expect(
      listOpenAiCompatibleModels({
        baseUrl: `${api.baseUrl}/`,
        apiKey: 'k',
        timeout: fiveSeconds(),
      }),
    ).resolves.toStrictEqual({ ok: true, value: ['llama3.2:3b', 'qwen3:8b'] });
    expect(api.requests[0]).toMatchObject({
      method: 'GET',
      url: '/v1/models',
      authorization: 'Bearer k',
    });
  });

  test('reports a server without the endpoint, and one that is down', async ({
    expect,
    openAiApi,
  }) => {
    const api = await openAiApi();
    await expect(
      listOpenAiCompatibleModels({ baseUrl: api.baseUrl, timeout: fiveSeconds() }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'model-failed', status: 404 } });
    api.close();
    await expect(
      listOpenAiCompatibleModels({ baseUrl: api.baseUrl, timeout: fiveSeconds() }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'model-failed', reason: 'unreachable' } });
  });
});
