import type { ReviewRangeChoiceView } from '#contract/ipc-contract.ts';

/**
 * The review range menu's trigger (ADR 0157): what the diff shows, so one control says it and
 * changes it. Since the last save it is the scope itself (`Interdiff · exact`, `Up to date`);
 * the whole change says so; an earlier save qualifies the scope. Pure.
 */
export function rangeTriggerLabelFrom(scopeText: string, choice: ReviewRangeChoiceView): string {
  switch (choice.kind) {
    case 'since-last': {
      return scopeText;
    }
    case 'whole': {
      return 'Whole change';
    }
    case 'since-checkpoint': {
      return `${scopeText} since an earlier save`;
    }
  }
}
