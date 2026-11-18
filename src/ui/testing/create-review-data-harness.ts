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
  /** Turns other reviewers' comments on or off, as the display preference does. */
  readonly chooseComments: (isShown: boolean) => void;
}

/** Options of {@link createReviewDataHarness}. */
export interface ReviewDataHarnessOptions {
  /** The open review at the start; none by default. */
  readonly review?: ReviewView;
  /** Whether other reviewers' comments are wanted at the start; off by default. */
  readonly showReviewComments?: boolean;
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
  let isCommentsShown = options.showReviewComments === true;
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
    showReviewComments: (): boolean => {
      return isCommentsShown;
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
    chooseComments: (isShown): void => {
      isCommentsShown = isShown;
    },
  };
}
