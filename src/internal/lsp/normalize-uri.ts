import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * A canonical spelling of a document URI, so `file:///a%20b` and `file:///a b` style differences
 * between client and server encoders don't split one document in two. Non-file URIs pass through.
 */
export function normalizeUri(uri: string): string {
  if (!uri.startsWith('file:')) {
    return uri;
  }
  try {
    return pathToFileURL(fileURLToPath(uri)).href;
  } catch {
    return uri;
  }
}
