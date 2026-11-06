import type { ReactiveControllerHost } from 'lit';

import type { BeuveApi } from '#contract/ipc-contract.ts';

import type { StatusNotice } from '../describe-editor-open.ts';
import { GithubController } from '../github-controller.ts';
import type { ReviewRef } from '../review-ref.ts';

/** A {@link GithubController} wired to fakes, with what the fakes saw. */
export interface GithubHarness {
  readonly github: GithubController;
  /** `[channel, request]` of each `invoke`, in order. */
  readonly invoked: readonly (readonly [string, unknown])[];
  readonly notices: readonly StatusNotice[];
  readonly selected: readonly string[];
  readonly refreshes: () => number;
  /** Each `setOpenDialog` call, in order. */
  readonly dialogs: readonly boolean[];
  readonly updates: () => number;
  /** Delivers an event to the controller's subscription, if one is held. */
  readonly emit: (
    channel: 'github:pr-updated' | 'github:ci-status' | 'github:branch-updated',
    payload: unknown,
  ) => void;
  readonly listening: () => number;
}

/** Options of {@link createGithubHarness}. */
export interface GithubHarnessOptions {
  /** The open review; none by default. */
  readonly review?: ReviewRef;
  /** The whole result each channel's `invoke` answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
}

export function createGithubHarness(options: GithubHarnessOptions = {}): GithubHarness {
  const invoked: (readonly [string, unknown])[] = [];
  const notices: StatusNotice[] = [];
  const selected: string[] = [];
  const dialogs: boolean[] = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  let refreshes = 0;
  let updates = 0;
  const bridge = {
    invoke: async (channel: string, request: unknown): Promise<unknown> => {
      await Promise.resolve();
      invoked.push([channel, request]);
      return options.replies?.[channel] ?? { ok: true, value: undefined };
    },
    on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
      listeners.set(channel, listener);
      return (): void => {
        listeners.delete(channel);
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
  const github = new GithubController(host, {
    bridge: (): BeuveApi => {
      return bridge;
    },
    review: (): ReviewRef | undefined => {
      return options.review;
    },
    notify: (notice): void => {
      notices.push(notice);
    },
    refreshSessions: async (): Promise<void> => {
      await Promise.resolve();
      refreshes += 1;
    },
    selectSession: async (sessionId): Promise<void> => {
      await Promise.resolve();
      selected.push(sessionId);
    },
    setOpenDialog: (isOpen): void => {
      dialogs.push(isOpen);
    },
  });
  return {
    github,
    invoked,
    notices,
    selected,
    dialogs,
    refreshes: (): number => {
      return refreshes;
    },
    updates: (): number => {
      return updates;
    },
    emit: (channel, payload): void => {
      listeners.get(channel)?.(payload);
    },
    listening: (): number => {
      return listeners.size;
    },
  };
}
