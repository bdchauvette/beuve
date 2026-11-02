/** Whether `/review` findings annotate the diff, for the notice after `/insights`. */
export function describeInsights(isShown: boolean): string {
  if (isShown) {
    return 'Review insights: shown on the diff (/insights hide removes them)';
  }
  return 'Review insights: hidden (/insights show brings them back)';
}
