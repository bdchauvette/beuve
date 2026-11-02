import type { BeuveApi } from '#contract/ipc-contract.ts';

import type { StatusNotice } from '../describe-editor-open.ts';
import { SettingsController } from '../settings-controller.ts';
import type { DisplayTransition } from '../settings-controller.ts';
import { createFakeBridge } from './create-fake-bridge.ts';
import type { FakeBridge } from './create-fake-bridge.ts';
import { createFakeHost } from './create-fake-host.ts';

/** A {@link SettingsController} wired to fakes. */
export interface SettingsHarness extends FakeBridge {
  readonly settings: SettingsController;
  readonly notices: readonly StatusNotice[];
  readonly applied: readonly DisplayTransition[];
  readonly updates: () => number;
}

/** Options of {@link createSettingsHarness}. */
export interface SettingsHarnessOptions {
  /** The whole result each channel answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
  /** Whether the page has the preload bridge; it has by default. */
  readonly hasBridge?: boolean;
}

export function createSettingsHarness(options: SettingsHarnessOptions = {}): SettingsHarness {
  const fake = createFakeBridge({
    ...(options.replies !== undefined && { replies: options.replies }),
  });
  const { host, updates } = createFakeHost();
  const notices: StatusNotice[] = [];
  const applied: DisplayTransition[] = [];
  const settings = new SettingsController(host, {
    bridge: (): BeuveApi | undefined => {
      if (options.hasBridge === false) {
        return undefined;
      }
      return fake.bridge;
    },
    notify: (notice): void => {
      notices.push(notice);
    },
    displayApplied: (transition): void => {
      applied.push(transition);
    },
  });
  return { ...fake, settings, notices, applied, updates };
}
