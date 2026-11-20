/** Whether the review dock lists addressed notes, for the notice after the toggle (ADR 0149). */
export function describeAddressedNotesSwitch(isShown: boolean): string {
  if (isShown) {
    return 'Addressed notes: listed in Review (Review, Note, Show Addressed Notes hides them)';
  }
  return 'Addressed notes: hidden from Review (Review, Note, Show Addressed Notes lists them again)';
}
