/** Whether `/review` findings annotate the diff, for the notice after the setting changes. */
export function describeInsights(isShown: boolean): string {
  if (isShown) {
    return 'Review insights: shown on the diff';
  }
  return 'Review insights: hidden';
}
