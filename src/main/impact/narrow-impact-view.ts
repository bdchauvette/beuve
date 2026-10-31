import type { ImpactView } from '#contract/ipc-contract.ts';

/**
 * Keeps only the files at `paths` (head or previous path) and their findings, with totals
 * recounted. Percentiles still rank against the whole review's head functions.
 */
export function narrowImpactView(view: ImpactView, paths: readonly string[]): ImpactView {
  const wanted = new Set(paths);
  const files = view.files.filter((file) => {
    return (
      wanted.has(file.path) || (file.previousPath !== undefined && wanted.has(file.previousPath))
    );
  });
  const kept = new Set(files.map((file) => file.path));
  const findings = view.findings.filter((finding) => kept.has(finding.path));
  const functions = files.flatMap((file) => {
    return file.status === 'analyzed' ? file.functions : [];
  });
  const count = (...changes: string[]): number => {
    return functions.filter((entry) => changes.includes(entry.change)).length;
  };
  return {
    ...view,
    files,
    findings,
    totals: {
      analyzedFiles: files.filter((file) => file.status === 'analyzed').length,
      skippedFiles: files.filter((file) => file.status === 'skipped').length,
      added: count('added'),
      removed: count('removed'),
      modified: count('modified', 'renamed'),
      cognitiveDelta: functions.reduce((sum, entry) => {
        return sum + entry.delta.cognitive;
      }, 0),
      findings: findings.length,
    },
  };
}
