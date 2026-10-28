import { readFile } from 'node:fs/promises';

/**
 * The top-level object of `<userData>/settings.json`, main's JSON settings file (ADR 0033). A
 * missing, unreadable or malformed file reads as `{}`, so a bad file never blocks startup.
 */
export async function readSettingsFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
