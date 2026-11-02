/** What Next and Previous Change do with reviewed files, for the notice after the toggle. */
export function describeSkipReviewed(isSkipping: boolean | undefined): string {
  if (isSkipping === true) {
    return 'Next and Previous Change skip files marked reviewed';
  }
  return 'Next and Previous Change stop at every file, reviewed or not';
}
