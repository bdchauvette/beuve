import type {
  DiffDisplayView,
  DiffLayoutView,
  IpcResult,
  ReviewOrderMode,
  SetDiffDisplayRequest,
  SheetModeView,
  SidebarSideView,
} from '#contract/ipc-contract.ts';
import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';
import { ok } from '#x/result/ok.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

import { branchPrefixesFrom } from './branch-prefixes-from.ts';
import { reviewQueuePrefsFrom } from './review-queue-prefs-from.ts';

/**
 * `display:get` and `display:set`: the diff layout, whitespace, sidebar side and generated-file
 * preferences.
 */
export interface DisplayServices {
  readonly get: () => Promise<IpcResult<DiffDisplayView>>;
  readonly set: (request: SetDiffDisplayRequest) => Promise<IpcResult<DiffDisplayView>>;
}

const reviewOrderModes: ReadonlySet<string> = new Set(['path', 'imports', 'calls']);

const defaults: Required<DiffDisplayView> = {
  layout: 'split',
  ignoreWhitespace: false,
  sidebarSide: 'right',
  showGenerated: false,
  showInsights: true,
  showDiagnostics: true,
  reviewOrder: 'path',
  skipReviewed: false,
  sheets: 'window',
  reviewQueue: defaultReviewQueuePrefs,
  reviewQueueBranchPrefixes: branchPrefixesFrom(undefined),
};

/**
 * Keeps the display preferences (ADR 0042, 0044, 0052) in the JSON file at `filePath`
 * (`<userData>/settings.json`) as `diffLayout`, `ignoreWhitespace`, `sidebarSide` and
 * `showGenerated`, `showInsights` (ADR 0061), `showDiagnostics` (ADR 0111), `reviewOrder` (ADR 0065), `skipReviewed` (ADR 0064), `sheets` (ADR 0067), the review queue's `reviewQueue` and `reviewQueueBranchPrefixes` (ADR 0113), next to any other keys. A missing or malformed value reads as the default:
 * split, whitespace shown, sidebar on the right, generated files collapsed, insights shown, files in path order, reviewed files not skipped, definitions in sheet windows. Without a path, in
 * memory.
 */
export function createDisplayServices(filePath?: string): DisplayServices {
  let remembered: Required<DiffDisplayView> = defaults;
  const read = async (): Promise<Required<DiffDisplayView>> => {
    if (filePath === undefined) {
      return remembered;
    }
    return displayFrom(await readSettingsFile(filePath));
  };
  return {
    get: async (): Promise<IpcResult<DiffDisplayView>> => {
      return ok(await read());
    },
    set: async (request): Promise<IpcResult<DiffDisplayView>> => {
      const next = { ...(await read()), ...request };
      next.reviewQueueBranchPrefixes = branchPrefixesFrom(next.reviewQueueBranchPrefixes);
      remembered = next;
      if (filePath !== undefined) {
        await updateSettingsFile(filePath, (current) => {
          return {
            ...current,
            diffLayout: next.layout,
            ignoreWhitespace: next.ignoreWhitespace,
            sidebarSide: next.sidebarSide,
            showGenerated: next.showGenerated,
            showInsights: next.showInsights,
            showDiagnostics: next.showDiagnostics,
            reviewOrder: next.reviewOrder,
            skipReviewed: next.skipReviewed,
            sheets: next.sheets,
            reviewQueue: next.reviewQueue,
            reviewQueueBranchPrefixes: next.reviewQueueBranchPrefixes,
          };
        });
      }
      return ok(next);
    },
  };
}

function displayFrom(settings: Readonly<Record<string, unknown>>): Required<DiffDisplayView> {
  const layout = settings['diffLayout'];
  const ignoreWhitespace = settings['ignoreWhitespace'];
  const sidebarSide = settings['sidebarSide'];
  const showGenerated = settings['showGenerated'];
  const showInsights = settings['showInsights'];
  const showDiagnostics = settings['showDiagnostics'];
  const reviewOrder = settings['reviewOrder'];
  const skipReviewed = settings['skipReviewed'];
  const sheets = settings['sheets'];
  return {
    layout: validOr(layout, isLayout, defaults.layout),
    ignoreWhitespace: validOr(ignoreWhitespace, isBoolean, defaults.ignoreWhitespace),
    sidebarSide: validOr(sidebarSide, isSidebarSide, defaults.sidebarSide),
    showGenerated: validOr(showGenerated, isBoolean, defaults.showGenerated),
    showInsights: validOr(showInsights, isBoolean, defaults.showInsights),
    showDiagnostics: validOr(showDiagnostics, isBoolean, defaults.showDiagnostics),
    reviewOrder: validOr(reviewOrder, isReviewOrder, defaults.reviewOrder),
    skipReviewed: validOr(skipReviewed, isBoolean, defaults.skipReviewed),
    sheets: validOr(sheets, isSheetMode, defaults.sheets),
    reviewQueue: reviewQueuePrefsFrom(settings['reviewQueue']),
    reviewQueueBranchPrefixes: branchPrefixesFrom(settings['reviewQueueBranchPrefixes']),
  };
}

/** The stored value when `isValid` accepts it, else the default. */
function validOr<T>(
  value: unknown,
  isValid: (candidate: unknown) => candidate is T,
  fallback: T,
): T {
  if (isValid(value)) {
    return value;
  }
  return fallback;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isLayout(value: unknown): value is DiffLayoutView {
  return value === 'split' || value === 'unified';
}

function isReviewOrder(value: unknown): value is ReviewOrderMode {
  return typeof value === 'string' && reviewOrderModes.has(value);
}

function isSheetMode(value: unknown): value is SheetModeView {
  return value === 'window' || value === 'inline';
}

function isSidebarSide(value: unknown): value is SidebarSideView {
  return value === 'left' || value === 'right';
}
