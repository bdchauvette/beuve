import type {
  DiffFileView,
  FileAttributionView,
  ReviewOrderView,
  ReviewView,
} from '#contract/ipc-contract.ts';

import { fileForCommitPair } from './file-for-commit-pair.ts';

/** The cards the diff stream shows, in order, and the divider above a group's first card. */
export interface ReviewStreamPlan {
  readonly files: readonly DiffFileView[];
  /** Index into `files` → the label of the group that starts there (never the first changes). */
  readonly groupLabels: ReadonlyMap<number, string>;
}

/**
 * What the diff stream shows of `review` (ADR 0054, 0065): its files in `order` when that order is
 * for the review's head (else as given, which is path order), with a label above each group but
 * the plain changes; narrowed to commit pair `pairId` when one is chosen. Files the order does not
 * name keep their place after the ordered ones. Pure.
 */
export function planReviewStream(
  review: Pick<ReviewView, 'files' | 'headSha' | 'fileAttribution'>,
  order: ReviewOrderView | undefined,
  pairId: string | undefined,
): ReviewStreamPlan {
  const ordered = orderedFiles(review, order);
  const attributions = new Map<string, FileAttributionView>(
    (review.fileAttribution ?? []).map((entry) => {
      return [entry.path, entry];
    }),
  );
  const files: DiffFileView[] = [];
  const groupLabels = new Map<number, string>();
  const labelled = new Set<string>();
  for (const { file, group } of ordered) {
    let shown: DiffFileView | undefined = file;
    if (pairId !== undefined) {
      shown = fileForCommitPair(file, attributions.get(file.path), pairId);
    }
    if (shown === undefined) {
      continue;
    }
    if (group !== undefined && !labelled.has(group)) {
      labelled.add(group);
      groupLabels.set(files.length, group);
    }
    files.push(shown);
  }
  return { files, groupLabels };
}

/** A file in stream order, under the label of the group it starts, if any. */
interface OrderedFile {
  readonly file: DiffFileView;
  readonly group: string | undefined;
}

function orderedFiles(
  review: Pick<ReviewView, 'files' | 'headSha'>,
  order: ReviewOrderView | undefined,
): OrderedFile[] {
  if (order?.headSha !== review.headSha) {
    return review.files.map((file) => {
      return { file, group: undefined };
    });
  }
  const byPath = new Map(
    review.files.map((file) => {
      return [file.path, file];
    }),
  );
  const placed = new Set<string>();
  const entries: OrderedFile[] = [];
  for (const group of order.groups) {
    for (const path of group.paths) {
      const file = byPath.get(path);
      if (file === undefined || placed.has(path)) {
        continue;
      }

      placed.add(path);
      entries.push({ file, group: groupLabel(group) });
    }
  }
  for (const file of review.files) {
    if (!placed.has(file.path)) {
      entries.push({ file, group: undefined });
    }
  }
  return entries;
}

/** The heading a group gets in the stream; the catch-all group of other changes gets none. */
function groupLabel(group: ReviewOrderView['groups'][number]): string | undefined {
  if (group.id === 'changes') {
    return undefined;
  }
  return group.label;
}
