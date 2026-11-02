import type { BeuveApi } from '#contract/ipc-contract.ts';

import type { ReviewRef } from '../review-ref.ts';
import { UraController } from '../ura-controller.ts';
import { createFakeBridge } from './create-fake-bridge.ts';
import type { FakeBridge } from './create-fake-bridge.ts';
import { createFakeHost } from './create-fake-host.ts';

/** A {@link UraController} wired to fakes. */
export interface UraHarness extends FakeBridge {
  readonly ura: UraController;
  readonly updates: () => number;
}

/** Options of {@link createUraHarness}. */
export interface UraHarnessOptions {
  /** The open review; none by default. */
  readonly review?: ReviewRef;
  /** The whole result each channel answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
}

export function createUraHarness(options: UraHarnessOptions = {}): UraHarness {
  const fake = createFakeBridge({
    ...(options.replies !== undefined && { replies: options.replies }),
  });
  const { host, updates } = createFakeHost();
  const ura = new UraController(host, {
    bridge: (): BeuveApi => {
      return fake.bridge;
    },
    review: (): ReviewRef | undefined => {
      return options.review;
    },
  });
  return { ...fake, ura, updates };
}
