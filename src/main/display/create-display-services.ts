import type {
  DiffDisplayView,
  DiffLayoutView,
  IpcResult,
  ReviewOrderMode,
  SetDiffDisplayRequest,
  SheetModeView,
  SidebarSideView,
} from '#contract/ipc-contract.ts';
import { ok } from '#x/result/ok.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

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
  reviewOrder: 'path',
  skipReviewed: false,
  sheets: 'window',
};

/**
 * Keeps the display preferences (ADR 0042, 0044, 0052) in the JSON file at `filePath`
 * (`<userData>/settings.json`) as `diffLayout`, `ignoreWhitespace`, `sidebarSide` and
 * `showGenerated`, `showInsights` (ADR 0061), `reviewOrder` (ADR 0065), `skipReviewed` (ADR 0064) and `sheets` (ADR 0067), next to any other keys. A missing or malformed value reads as the default:
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
            reviewOrder: next.reviewOrder,
            skipReviewed: next.skipReviewed,
            sheets: next.sheets,
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
  const reviewOrder = settings['reviewOrder'];
  const skipReviewed = settings['skipReviewed'];
  const sheets = settings['sheets'];
  return {
    layout: isLayout(layout) ? layout : defaults.layout,
    ignoreWhitespace:
      typeof ignoreWhitespace === 'boolean' ? ignoreWhitespace : defaults.ignoreWhitespace,
    sidebarSide: isSidebarSide(sidebarSide) ? sidebarSide : defaults.sidebarSide,
    showGenerated: typeof showGenerated === 'boolean' ? showGenerated : defaults.showGenerated,
    showInsights: typeof showInsights === 'boolean' ? showInsights : defaults.showInsights,
    reviewOrder: isReviewOrder(reviewOrder) ? reviewOrder : defaults.reviewOrder,
    skipReviewed: typeof skipReviewed === 'boolean' ? skipReviewed : defaults.skipReviewed,
    sheets: isSheetMode(sheets) ? sheets : defaults.sheets,
  };
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
