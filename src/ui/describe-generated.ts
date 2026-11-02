/** Whether generated files are expanded, for the notice after `/generated`. */
export function describeGenerated(isShown: boolean): string {
  if (isShown) {
    return 'Generated files: shown (/generated hide collapses them)';
  }
  return 'Generated files: collapsed (/generated show expands them)';
}
