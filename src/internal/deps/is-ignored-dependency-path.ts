const ignoredSegments = new Set(['node_modules', 'vendor', '.venv', 'target', '.git']);

/**
 * Whether a repository-relative path lies under a dependency or build directory (`node_modules`,
 * `vendor`, `.venv`, `target`): lockfiles and manifests there belong to installed packages, not
 * to the reviewed project, so they are neither units nor dependency inputs.
 */
export function isIgnoredDependencyPath(file: string): boolean {
  const segments = file.split('/');
  return segments.slice(0, -1).some((segment) => ignoredSegments.has(segment));
}
