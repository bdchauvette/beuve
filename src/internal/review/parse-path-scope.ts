/** Reads a stored path scope back; `undefined` when it is not a JSON array of strings. */
export function parsePathScope(stored: unknown): readonly string[] | undefined {
  if (typeof stored !== 'string') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
