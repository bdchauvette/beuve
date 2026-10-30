import type { FileImpactView, FunctionImpactView, ImpactView } from '#contract/ipc-contract.ts';

/** Function rows the renderer's popover shows per file. */
const shownFunctions = 8;

/**
 * The renderer's copy of an impact view (ADR 0053): per file the aggregate and the few changed
 * functions the popover lists, worst head value first, with `omittedFunctions` counting the rest.
 * Findings, totals and percentiles are untouched. The renderer reads nothing else, and a review of
 * hundreds of files shrinks from megabytes to tens of kilobytes.
 */
export function slimImpactView(view: ImpactView): ImpactView {
  return { ...view, files: view.files.map((file) => slimFile(file)) };
}

function slimFile(file: FileImpactView): FileImpactView {
  if (file.status === 'skipped') {
    return file;
  }
  const changed = file.functions
    .filter((entry) => entry.inDiff && entry.change !== 'unchanged')
    .toSorted((a, b) => headValue(b) - headValue(a));
  const omitted = changed.length - shownFunctions;
  return {
    ...file,
    functions: changed.slice(0, shownFunctions),
    ...(omitted > 0 && { omittedFunctions: omitted }),
  };
}

function headValue(entry: FunctionImpactView): number {
  return entry.change === 'removed' ? -1 : entry.head.metrics.cognitive;
}
