/** Whether other reviewers' line comments show on the diff, for the notice after the toggle. */
export function describeReviewCommentsSwitch(isShown: boolean): string {
  if (isShown) {
    return 'Other reviewers’ comments: shown on the diff (View, Diff, Show Other Reviewers’ Comments hides them)';
  }
  return 'Other reviewers’ comments: hidden (View, Diff, Show Other Reviewers’ Comments brings them back)';
}
