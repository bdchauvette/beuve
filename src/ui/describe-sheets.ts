import type { DiffDisplayView } from '#contract/ipc-contract.ts';

/** Where definitions open, for the notice after `/sheets` or Sheets ▸ Open Definitions In. */
export function describeSheets(sheets: DiffDisplayView['sheets']): string {
  if (sheets === 'inline') {
    return 'Definitions open over the diff.';
  }
  return 'Definitions open in a new sheet window each.';
}
