import type { BeuveApi, ReviewOrderMode, ReviewView } from '#contract/ipc-contract.ts';

import type { StatusNotice } from '../describe-editor-open.ts';
import { ReviewDataController } from '../review-data-controller.ts';
import { createFakeBridge } from './create-fake-bridge.ts';
import type { FakeBridge } from './create-fake-bridge.ts';
import { createFakeHost } from './create-fake-host.ts';

/** A {@link ReviewDataController} wired to fakes. */
export interface ReviewDataHarness extends FakeBridge {
  readonly data: ReviewDataController;
  readonly notices: readonly StatusNotice[];
  readonly updates: () => number;
  /** Opens another review, as the window does when the session changes. */
  readonly showReview: (review: ReviewView | undefined) => void;
  /** Chooses another file order. */
  readonly chooseOrder: (mode: ReviewOrderMode) => void;
}

/** Options of {@link createReviewDataHarness}. */
export interface ReviewDataHarnessOptions {
  /** The open review at the start; none by default. */
  readonly review?: ReviewView;
  /** The whole result each channel answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
}

export function createReviewDataHarness(options: ReviewDataHarnessOptions = {}): ReviewDataHarness {
  const fake = createFakeBridge({
    ...(options.replies !== undefined && { replies: options.replies }),
  });
  const { host, updates } = createFakeHost();
  const notices: StatusNotice[] = [];
  let review = options.review;
  let order: ReviewOrderMode = 'path';
  const data = new ReviewDataController(host, {
    bridge: (): BeuveApi => {
      return fake.bridge;
    },
    review: (): ReviewView | undefined => {
      return review;
    },
    reviewOrder: (): ReviewOrderMode => {
      return order;
    },
    notify: (notice): void => {
      notices.push(notice);
    },
  });
  return {
    ...fake,
    data,
    notices,
    updates,
    showReview: (next): void => {
      review = next;
    },
    chooseOrder: (mode): void => {
      order = mode;
    },
  };
}
