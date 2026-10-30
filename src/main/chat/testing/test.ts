import type { ChatDeltaView, ChatMessageView } from '#contract/ipc-contract.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test as baseTest } from '../../testing/test.ts';
import type { CreateServices } from '../../testing/test.ts';
import type { MainServices } from '../../main-services.ts';
import type { ClaudeCodeSettings } from '../claude-code-settings.ts';
import { chatBranchTemplate } from './chat-branch-template.ts';
import { waitForSettled } from './wait-for-settled.ts';

/** A started chat: the services, a local session on `feature`, and what the chat published. */
export interface ChatHarness {
  readonly services: MainServices;
  readonly chat: MainServices['chat'];
  readonly sessionId: string;
  /** Every `chat:delta` so far. */
  readonly deltas: ChatDeltaView[];
  /** Every settled-or-started message update so far. */
  readonly updates: ChatMessageView[];
  /** Resolves with the update that ends `messageId`'s run (anything but queued or streaming). */
  readonly settled: (messageId: string) => Promise<ChatMessageView>;
}

/** Starts the chat services over `claude`; each call makes a fresh set over the same database. */
export type StartChat = (claude: ClaudeCodeSettings) => Promise<ChatHarness>;

/**
 * `src/main`'s `test` with chat fixtures (ADR 0058): `repo` is {@link chatBranchTemplate} (`main`
 * with `app.rs`, `feature` adding `feature.rs`, `main` checked out) and `startChat` runs the chat
 * through `createMainServices` with a fake `claude` (ADR 0031).
 */
export const test = baseTest
  .extend('repo', async ({ repositories }): Promise<TestRepository> => {
    const { repo } = await repositories.fromTemplate(chatBranchTemplate());
    return repo;
  })
  .extend('startChat', ({ createServices, repo }): StartChat => startChat(createServices, repo));

function startChat(createServices: CreateServices, repo: TestRepository): StartChat {
  return async (claude): Promise<ChatHarness> => {
    const services = createServices({
      claude: { killGrace: Temporal.Duration.from({ milliseconds: 200 }), ...claude },
    });
    const deltas: ChatDeltaView[] = [];
    const updates: ChatMessageView[] = [];
    services.chat.onDelta((event) => {
      deltas.push(event);
    });
    services.chat.onMessageUpdated((event) => {
      updates.push(event.message);
    });
    const { id } = okValueFrom(
      await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    );
    const settled = async (messageId: string): Promise<ChatMessageView> =>
      waitForSettled(updates, messageId);
    return { services, chat: services.chat, sessionId: id, deltas, updates, settled };
  };
}
