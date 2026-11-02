import type { BeuveApi } from '#contract/ipc-contract.ts';

import { SessionController } from '../session-controller.ts';
import type { ReviewLoaded } from '../session-controller.ts';
import { createFakeBridge } from './create-fake-bridge.ts';
import type { FakeBridge } from './create-fake-bridge.ts';
import { createFakeHost } from './create-fake-host.ts';

/** A {@link SessionController} wired to fakes, with the hooks it called. */
export interface SessionHarness extends FakeBridge {
  readonly session: SessionController;
  /** The hooks the controller called, in order: `closed`, `switching`, `reloading`, `settled`. */
  readonly hooks: readonly string[];
  readonly loaded: readonly ReviewLoaded[];
  readonly updates: () => number;
}

/** Options of {@link createSessionHarness}. */
export interface SessionHarnessOptions {
  /** The whole result each channel answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
  /** Whether the page has the preload bridge; it has by default. */
  readonly hasBridge?: boolean;
  /** Whether the diff ignores whitespace; it does not by default. */
  readonly ignoresWhitespace?: boolean;
}

export function createSessionHarness(options: SessionHarnessOptions = {}): SessionHarness {
  const fake = createFakeBridge({
    ...(options.replies !== undefined && { replies: options.replies }),
  });
  const { host, updates } = createFakeHost();
  const hooks: string[] = [];
  const loaded: ReviewLoaded[] = [];
  const session = new SessionController(host, {
    bridge: (): BeuveApi | undefined => {
      if (options.hasBridge === false) {
        return undefined;
      }
      return fake.bridge;
    },
    ignoreWhitespace: (): boolean => {
      return options.ignoresWhitespace === true;
    },
    closeOpenDialog: (): void => {
      hooks.push('closed');
    },
    switching: (): void => {
      hooks.push('switching');
    },
    reloading: (): void => {
      hooks.push('reloading');
    },
    settled: (): void => {
      hooks.push('settled');
    },
    loaded: (change): void => {
      loaded.push(change);
    },
  });
  return { ...fake, session, hooks, loaded, updates };
}
