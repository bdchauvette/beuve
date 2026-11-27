import type { UraItemView, UraOutdatedReasonView } from '#contract/ipc-contract.ts';

import type { SuggestionFieldView } from './suggestion-field-view.ts';

const outdatedReasons: Readonly<Record<UraOutdatedReasonView, string>> = {
  'lines-changed': 'Outdated: the lines changed since',
  'file-deleted': 'Outdated: the file was deleted since',
  'no-line-mapping': 'Outdated: its head is gone',
};

/**
 * A note's suggestions as the fields its editor opens with (ADR 0162), in order: each starts from
 * its replacement and keeps its id, so saving edits it in place; an outdated one says why. Pure.
 */
export function suggestionFieldsFrom(item: UraItemView): SuggestionFieldView[] {
  return item.suggestions.map((suggestion): SuggestionFieldView => {
    const { id, path, startLine, endLine, replacement, placement } = suggestion;
    return {
      key: id,
      id,
      headSha: item.headSha,
      path,
      startLine,
      endLine,
      replacement,
      ...(placement.kind === 'outdated' && { outdated: outdatedReasons[placement.reason] }),
    };
  });
}
