import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { test as baseTest } from '#testing/test.ts';

import { startFakeMessagesApi } from './start-fake-messages-api.ts';
import { startFakeOpenAiApi } from './start-fake-open-ai-api.ts';
import type { FakeOpenAiApi, FakeOpenAiOptions } from './start-fake-open-ai-api.ts';
import type { FakeMessagesApi } from './start-fake-messages-api.ts';
import { writeFakeClaude } from './write-fake-claude.ts';

/**
 * `#testing/test.ts` with the fake `claude` CLI (ADR 0058): `fakeClaude` (worker) is the path of
 * the script {@link writeFakeClaude} wrote once into the worker's `tempRoot`. Run it with
 * `process.execPath`; a test keeps its pid and script files in its own `tempDir`.
 * `messagesApi` is a fresh {@link startFakeMessagesApi} server, closed after the test, for the
 * Agent SDK adapter's real Claude Code to talk to. `openAiApi` starts {@link startFakeOpenAiApi}
 * servers, each closed after the test.
 */
export const test = baseTest
  .extend('fakeClaude', { scope: 'worker' }, ({ tempRoot }): string => {
    const directory = path.join(tempRoot, 'fake-claude');
    mkdirSync(directory, { recursive: true });
    return writeFakeClaude(directory);
  })
  .extend('messagesApi', async ({}, { onCleanup }): Promise<FakeMessagesApi> => {
    const api = await startFakeMessagesApi();
    onCleanup(() => {
      api.close();
    });
    return api;
  })
  .extend(
    'openAiApi',
    ({}, { onCleanup }): ((options?: FakeOpenAiOptions) => Promise<FakeOpenAiApi>) => {
      const started: FakeOpenAiApi[] = [];
      onCleanup(() => {
        for (const api of started) {
          api.close();
        }
      });
      return async (options): Promise<FakeOpenAiApi> => {
        const api = await startFakeOpenAiApi(options);
        started.push(api);
        return api;
      };
    },
  );
