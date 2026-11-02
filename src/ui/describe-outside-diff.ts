import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/** The notice for a chip or citation that points at lines the review does not change. */
export function describeOutsideDiff(place: string): string {
  return `${revealFormatControls(place)} is not in this diff: the file is unchanged by the review.`;
}
