import type { ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  ChatMessageView,
  ChatStatusView,
  ChatStreamEvent,
} from '#contract/ipc-contract.ts';

import { ChatController } from '../chat-controller.ts';
import type { ChatAppCommand } from '../chat-controller.ts';

/** A {@link ChatController} wired to fakes, with what the fakes saw. */
export interface ChatHarness {
  readonly chat: ChatController;
  /** `[channel, request]` of each `invoke`, in order. */
  readonly invoked: readonly (readonly [string, unknown])[];
  readonly drafts: readonly string[];
  readonly appCommands: readonly ChatAppCommand[];
  readonly updates: () => number;
  /** Delivers a `chat:stream` event to the listener, if one is subscribed. */
  readonly emit: (event: ChatStreamEvent) => void;
  readonly listening: () => boolean;
  readonly host: ReactiveControllerHost;
}

/** Options of {@link createChatHarness}. */
export interface ChatHarnessOptions {
  /** The open review's session; none by default. */
  readonly sessionId?: string;
  readonly focusPath?: string;
  /** The message every `invoke` answers with as a failure; every `invoke` succeeds if absent. */
  readonly failWith?: string;
  readonly hasBridge?: boolean;
  /** The status of the answer `chat:ask` returns; `done` by default. */
  readonly answerStatus?: ChatStatusView;
}

export function createChatHarness(options: ChatHarnessOptions = {}): ChatHarness {
  const invoked: (readonly [string, unknown])[] = [];
  const drafts: string[] = [];
  const appCommands: ChatAppCommand[] = [];
  let updates = 0;
  let listener: ((event: ChatStreamEvent) => void) | undefined;
  const bridge = {
    invoke: async (channel: string, request: unknown): Promise<unknown> => {
      await Promise.resolve();
      invoked.push([channel, request]);
      if (options.failWith !== undefined) {
        return { ok: false, error: { code: 'invalid-request', message: options.failWith } };
      }
      if (channel === 'chat:ask') {
        const answerStatus = options.answerStatus ?? 'done';
        return {
          ok: true,
          value: {
            question: messageOf('q1', 'user', 'done'),
            answer: messageOf('a1', 'assistant', answerStatus),
          },
        };
      }
      return { ok: true, value: { messages: [] } };
    },
    on: (_channel: string, next: (event: ChatStreamEvent) => void): (() => void) => {
      listener = next;
      return (): void => {
        listener = undefined;
      };
    },
  } as unknown as BeuveApi;
  const host = {
    addController: (): undefined => {
      return;
    },
    requestUpdate: (): void => {
      updates += 1;
    },
  } as unknown as ReactiveControllerHost;
  const chat = new ChatController(host, {
    bridge: (): BeuveApi | undefined => {
      if (options.hasBridge === false) {
        return undefined;
      }
      return bridge;
    },
    sessionId: (): string | undefined => {
      return options.sessionId;
    },
    focusPath: (): string | undefined => {
      return options.focusPath;
    },
    restoreDraft: (text: string): void => {
      drafts.push(text);
    },
    runAppCommand: (command): void => {
      appCommands.push(command);
    },
  });
  return {
    chat,
    invoked,
    drafts,
    appCommands,
    updates: (): number => {
      return updates;
    },
    emit: (event): void => {
      listener?.(event);
    },
    listening: (): boolean => {
      return listener !== undefined;
    },
    host,
  };
}

function messageOf(
  id: string,
  role: 'user' | 'assistant',
  status: ChatStatusView,
): ChatMessageView {
  return {
    id,
    sessionId: 's1',
    headSha: 'a'.repeat(40),
    role,
    parts: [],
    citations: [],
    status,
    createdAt: '2026-10-28T12:00:00Z',
  };
}
