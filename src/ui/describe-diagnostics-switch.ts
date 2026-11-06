/** Whether language-server diagnostics show on the diff, for the notice after the toggle. */
export function describeDiagnosticsSwitch(isShown: boolean): string {
  if (isShown) {
    return 'Diagnostics: shown on the diff (View, Diff, Show Diagnostics hides them)';
  }
  return 'Diagnostics: hidden (View, Diff, Show Diagnostics brings them back)';
}
