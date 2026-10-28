const objectIdPattern = /^(?:[\da-f]{40}|[\da-f]{64})$/u;

/** True when `text` is a full lowercase hex object name (40 for SHA-1, 64 for SHA-256). */
export function isObjectId(text: string): boolean {
  return objectIdPattern.test(text);
}
