import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import type { SuggestionLines } from './suggestion-field-view.ts';

/** What a suggestion field shows above itself, and the accessible name of its editor. */
export interface SuggestionLinesLabels {
  /** `src/a.ts:L10–12`, raw: render it with `pathText`. */
  readonly heading: string;
  /** "Suggestion for src/a.ts, lines 10 to 12", with format controls revealed (ADR 0082). */
  readonly name: string;
}

/**
 * The labels of a suggestion field over `lines` (ADR 0162): `path:Lstart–end` (`path:L7` for one
 * line, `path:L7 (insert before)` for an insertion before line 7) and its spoken form. Pure.
 */
export function describeSuggestionLines(lines: SuggestionLines): SuggestionLinesLabels {
  const { path, startLine, endLine } = lines;
  const start = String(startLine);
  const end = String(endLine);
  const spokenPath = revealFormatControls(path);
  if (endLine === startLine - 1) {
    return {
      heading: `${path}:L${start} (insert before)`,
      name: `Suggestion for ${spokenPath}, new lines before line ${start}`,
    };
  }
  if (startLine === endLine) {
    return { heading: `${path}:L${start}`, name: `Suggestion for ${spokenPath}, line ${start}` };
  }
  return {
    heading: `${path}:L${start}–${end}`,
    name: `Suggestion for ${spokenPath}, lines ${start} to ${end}`,
  };
}
