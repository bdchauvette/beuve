const driveLetter = /^[a-z]:/iu;

/**
 * Normalizes a repository-relative path prefix the reviewer typed (`/review src/ui/`): no leading
 * `./`, empty or `.` segments, or trailing `/`. `undefined` for an empty or absolute path, a `..`
 * segment or a NUL byte. Shared by the chat command parser and main's request validation.
 */
export function normalizePathPrefix(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') || driveLetter.test(trimmed) || trimmed.includes('\0')) {
    return undefined;
  }
  const segments = trimmed.split('/').filter((segment) => segment !== '' && segment !== '.');
  return segments.length === 0 || segments.includes('..') ? undefined : segments.join('/');
}
