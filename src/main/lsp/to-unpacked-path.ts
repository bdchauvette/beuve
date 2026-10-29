import path from 'node:path';

const archive = 'app.asar';

/**
 * The real-filesystem twin of a path inside a packaged app's `app.asar`: the first `app.asar`
 * segment becomes `app.asar.unpacked`, where electron-builder puts `asarUnpack` files (ADR 0048).
 * Paths outside an archive (development, tests) come back unchanged. Pure.
 */
export function toUnpackedPath(file: string, separator: string = path.sep): string {
  const segments = file.split(separator);
  const index = segments.indexOf(archive);
  return index === -1 ? file : segments.with(index, `${archive}.unpacked`).join(separator);
}
