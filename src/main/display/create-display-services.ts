import type {
  DiffDisplayView,
  DiffLayoutView,
  IpcResult,
  SetDiffDisplayRequest,
  SidebarSideView,
} from '#contract/ipc-contract.ts';
import { ok } from '#pkg/result/ok.ts';

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

const defaults: DiffDisplayView = {
  layout: 'split',
  ignoreWhitespace: false,
  sidebarSide: 'right',
  showGenerated: false,
};

/**
 * Keeps the display preferences (ADR 0042, 0044, 0052) in the JSON file at `filePath`
 * (`<userData>/settings.json`) as `diffLayout`, `ignoreWhitespace`, `sidebarSide` and
 * `showGenerated`, next to any other keys. A missing or malformed value reads as the default:
 * split, whitespace shown, sidebar on the right, generated files collapsed. Without a path, in
 * memory.
 */
export function createDisplayServices(filePath?: string): DisplayServices {
  let remembered = defaults;
  const read = async (): Promise<DiffDisplayView> =>
    filePath === undefined ? remembered : toDisplay(await readSettingsFile(filePath));
  return {
    get: async (): Promise<IpcResult<DiffDisplayView>> => ok(await read()),
    set: async (request): Promise<IpcResult<DiffDisplayView>> => {
      const next = { ...(await read()), ...request };
      remembered = next;
      if (filePath !== undefined) {
        await updateSettingsFile(filePath, (current) => ({
          ...current,
          diffLayout: next.layout,
          ignoreWhitespace: next.ignoreWhitespace,
          sidebarSide: next.sidebarSide,
          showGenerated: next.showGenerated,
        }));
      }
      return ok(next);
    },
  };
}

function toDisplay(settings: Readonly<Record<string, unknown>>): DiffDisplayView {
  const layout = settings['diffLayout'];
  const ignoreWhitespace = settings['ignoreWhitespace'];
  const sidebarSide = settings['sidebarSide'];
  const showGenerated = settings['showGenerated'];
  return {
    layout: isLayout(layout) ? layout : defaults.layout,
    ignoreWhitespace:
      typeof ignoreWhitespace === 'boolean' ? ignoreWhitespace : defaults.ignoreWhitespace,
    sidebarSide: isSidebarSide(sidebarSide) ? sidebarSide : defaults.sidebarSide,
    showGenerated: typeof showGenerated === 'boolean' ? showGenerated : defaults.showGenerated,
  };
}

function isLayout(value: unknown): value is DiffLayoutView {
  return value === 'split' || value === 'unified';
}

function isSidebarSide(value: unknown): value is SidebarSideView {
  return value === 'left' || value === 'right';
}
