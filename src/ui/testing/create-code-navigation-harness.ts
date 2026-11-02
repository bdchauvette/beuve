import type { BeuveApi, ReviewView } from '#contract/ipc-contract.ts';

import { CodeNavigationController } from '../code-navigation-controller.ts';
import type { StatusNotice } from '../describe-editor-open.ts';
import { createFakeBridge } from './create-fake-bridge.ts';
import type { FakeBridge } from './create-fake-bridge.ts';
import { createFakeHost } from './create-fake-host.ts';

/** A {@link CodeNavigationController} wired to fakes. */
export interface CodeNavigationHarness extends FakeBridge {
  readonly navigation: CodeNavigationController;
  readonly notices: readonly StatusNotice[];
  readonly updates: () => number;
  /** Opens another review, as the window does when the session changes. */
  readonly showReview: (review: ReviewView | undefined) => void;
}

/** Options of {@link createCodeNavigationHarness}. */
export interface CodeNavigationHarnessOptions {
  /** The open review at the start; none by default. */
  readonly review?: ReviewView;
  /** The whole result each channel answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
  /** Where definitions open; a new window each by default. */
  readonly sheetMode?: 'window' | 'inline';
}

export function createCodeNavigationHarness(
  options: CodeNavigationHarnessOptions = {},
): CodeNavigationHarness {
  const fake = createFakeBridge({
    ...(options.replies !== undefined && { replies: options.replies }),
  });
  const { host, updates } = createFakeHost();
  const notices: StatusNotice[] = [];
  let review = options.review;
  const navigation = new CodeNavigationController(host, {
    bridge: (): BeuveApi => {
      return fake.bridge;
    },
    review: (): ReviewView | undefined => {
      return review;
    },
    notify: (notice): void => {
      notices.push(notice);
    },
    sheetMode: (): 'window' | 'inline' => {
      return options.sheetMode ?? 'window';
    },
  });
  return {
    ...fake,
    navigation,
    notices,
    updates,
    showReview: (next): void => {
      review = next;
    },
  };
}
