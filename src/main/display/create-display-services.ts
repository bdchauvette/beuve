import type {
  DiffDisplayView,
  DiffLayoutView,
  IpcResult,
  SetDiffDisplayRequest,
} from '#contract/ipc-contract.ts';
import { ok } from '#pkg/result/ok.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

/** `display:get` and `display:set`: the reviewer's diff layout and whitespace preference. */
export interface DisplayServices {
  readonly get: () => Promise<IpcResult<DiffDisplayView>>;
  readonly set: (request: SetDiffDisplayRequest) => Promise<IpcResult<DiffDisplayView>>;
}

const defaults: DiffDisplayView = { layout: 'split', ignoreWhitespace: false };

/**
 * Keeps the diff display preferences (ADR 0042) in the JSON file at `filePath`
 * (`<userData>/settings.json`) as `diffLayout` and `ignoreWhitespace`, next to any other keys.
 * A missing or malformed value reads as the default: split, whitespace shown. Without a path,
 * in memory.
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
        }));
      }
      return ok(next);
    },
  };
}

function toDisplay(settings: Readonly<Record<string, unknown>>): DiffDisplayView {
  const layout = settings['diffLayout'];
  const ignoreWhitespace = settings['ignoreWhitespace'];
  return {
    layout: isLayout(layout) ? layout : defaults.layout,
    ignoreWhitespace:
      typeof ignoreWhitespace === 'boolean' ? ignoreWhitespace : defaults.ignoreWhitespace,
  };
}

function isLayout(value: unknown): value is DiffLayoutView {
  return value === 'split' || value === 'unified';
}
