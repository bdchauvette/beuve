/** A link or image source written in a file, and the repository path of that file. */
export interface RepositoryReference {
  /** The repository-relative path of the file that holds the reference. */
  readonly file: string;
  /** The reference's path part, without its query or fragment, still percent-encoded. */
  readonly reference: string;
}

/**
 * The repository-relative path a relative reference in a file names (ADR 0123): relative to the
 * file's directory, or to the repository root when it starts with `/`, as GitHub resolves them.
 * `undefined` when it climbs above the root, names the root itself, or does not decode. Pure.
 */
export function repositoryPathFrom({ file, reference }: RepositoryReference): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    return undefined;
  }
  const segments = file.split('/').slice(0, -1);
  if (decoded.startsWith('/')) {
    segments.length = 0;
  }
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return undefined;
  }
  return segments.join('/');
}
