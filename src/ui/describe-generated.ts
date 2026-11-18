/** Whether generated files are expanded, for the notice after the setting changes. */
export function describeGenerated(isShown: boolean): string {
  if (isShown) {
    return 'Generated files: shown';
  }
  return 'Generated files: collapsed';
}
