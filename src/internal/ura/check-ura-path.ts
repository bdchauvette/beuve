import { hasControlCharacters } from '#x/text/has-control-characters.ts';

/**
 * Why `path` is no path an anchor or a suggestion may name (ADR 0023): empty, with a control
 * character, or not repository-relative (an empty, `.` or `..` segment, which a leading or doubled
 * `/` makes); `undefined` when it is one.
 */
export function checkUraPath(path: string): string | undefined {
  if (path === '' || hasControlCharacters(path)) {
    return 'the path is empty or contains control characters';
  }
  const segments = path.split('/');
  const hasBadSegment = segments.some((segment) => {
    return ['', '.', '..'].includes(segment);
  });
  if (hasBadSegment) {
    return 'the path must be repository-relative, without empty, . or .. segments';
  }
  return undefined;
}
