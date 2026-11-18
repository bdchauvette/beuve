import type {
  CheckpointView,
  ReviewRangeChoiceView,
  ReviewRangeView,
} from '#contract/ipc-contract.ts';

/** One choice of the review header's range menu (ADR 0141). */
export interface ReviewRangeOption {
  /** Stable within the menu: the choice's kind, or the checkpoint's id. */
  readonly key: string;
  readonly label: string;
  readonly choice: ReviewRangeChoiceView;
  readonly isChecked: boolean;
  /** The saved progress it runs from, shown with its commit and time. */
  readonly checkpoint?: CheckpointView;
}

/** The range menu: its trigger's label and tooltip, the two main choices and earlier saves. */
export interface ReviewRangeMenu {
  readonly label: string;
  readonly title: string;
  readonly options: readonly ReviewRangeOption[];
  /** Saved progress before the last one, newest first. */
  readonly earlier: readonly ReviewRangeOption[];
}

const help =
  'Which changes the review shows: since your last saved progress, the whole change, or since an earlier save';

/**
 * The review header's range menu (ADR 0141), or `undefined` while nothing was ever saved: the
 * review then shows the whole change and there is nothing to choose.
 */
export function reviewRangeMenuFrom(
  range: ReviewRangeView | undefined,
): ReviewRangeMenu | undefined {
  const last = range?.checkpoints.at(-1);
  if (range === undefined || last === undefined) {
    return undefined;
  }
  const { choice } = range;
  const earlier = range.checkpoints
    .slice(0, -1)
    .toReversed()
    .map((checkpoint): ReviewRangeOption => {
      return {
        key: checkpoint.id,
        label: 'Since saved',
        choice: { kind: 'since-checkpoint', checkpointId: checkpoint.id },
        isChecked: choice.kind === 'since-checkpoint' && choice.checkpointId === checkpoint.id,
        checkpoint,
      };
    });
  return {
    label: labelOf(choice),
    title: help,
    options: [
      {
        key: 'since-last',
        label: 'Since last saved progress',
        choice: { kind: 'since-last' },
        isChecked: choice.kind === 'since-last',
        checkpoint: last,
      },
      {
        key: 'whole',
        label: 'Whole change',
        choice: { kind: 'whole' },
        isChecked: choice.kind === 'whole',
      },
    ],
    earlier,
  };
}

function labelOf(choice: ReviewRangeChoiceView): string {
  switch (choice.kind) {
    case 'since-last': {
      return 'Since last saved progress';
    }
    case 'whole': {
      return 'Whole change';
    }
    case 'since-checkpoint': {
      return 'Since an earlier save';
    }
  }
}
