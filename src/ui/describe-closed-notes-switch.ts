/** Whether the review dock lists closed (addressed and withdrawn) notes, for the notice after the toggle (ADR 0149). */
export function describeClosedNotesSwitch(isShown: boolean): string {
  if (isShown) {
    return 'Closed notes: addressed and withdrawn notes listed in Review (Note, Show Closed Notes hides them)';
  }
  return 'Closed notes: addressed and withdrawn notes hidden from Review (Note, Show Closed Notes lists them again)';
}
