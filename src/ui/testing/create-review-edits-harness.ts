import type { BeuveApi } from '#contract/ipc-contract.ts';

import { ReviewEditsController } from '../review-edits-controller.ts';
import type { StatusNotice } from '../describe-editor-open.ts';
import type { ReviewRef } from '../review-ref.ts';
import { createFakeBridge } from './create-fake-bridge.ts';
import type { FakeBridge } from './create-fake-bridge.ts';
import { createFakeHost } from './create-fake-host.ts';

/** A {@link ReviewEditsController} wired to fakes. */
export interface ReviewEditsHarness extends FakeBridge {
  readonly reviewEdits: ReviewEditsController;
  readonly notices: readonly StatusNotice[];
  /** Sessions whose staged items were asked to refresh. */
  readonly refreshed: readonly string[];
  readonly updates: () => number;
}

/** Options of {@link createReviewEditsHarness}. */
export interface ReviewEditsHarnessOptions {
  /** The open review; none by default. */
  readonly review?: ReviewRef;
  /** The whole result each channel answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
}

export function createReviewEditsHarness(
  options: ReviewEditsHarnessOptions = {},
): ReviewEditsHarness {
  const fake = createFakeBridge({
    ...(options.replies !== undefined && { replies: options.replies }),
  });
  const { host, updates } = createFakeHost();
  const notices: StatusNotice[] = [];
  const refreshed: string[] = [];
  const reviewEdits = new ReviewEditsController(host, {
    bridge: (): BeuveApi => {
      return fake.bridge;
    },
    review: (): ReviewRef | undefined => {
      return options.review;
    },
    notify: (notice): void => {
      notices.push(notice);
    },
    refreshStaged: async (sessionId): Promise<void> => {
      await Promise.resolve();
      refreshed.push(sessionId);
    },
  });
  return { ...fake, reviewEdits, notices, refreshed, updates };
}
