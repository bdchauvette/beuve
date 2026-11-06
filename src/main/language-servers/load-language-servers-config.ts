import { readFile } from 'node:fs/promises';

import { errorFrom } from '#x/error/error-from.ts';

import type { LanguageServersConfig } from './language-servers-config-schema.ts';
import { parseLanguageServersConfig } from './parse-language-servers-config.ts';

/** What reading the config files found. */
export interface LoadedLanguageServersConfig {
  /** One per file that exists and is valid, in the order the paths were given. */
  readonly layers: readonly LanguageServersConfig[];
  /** One sentence per file that could not be used, naming it. */
  readonly problems: readonly string[];
}

/** A config file is a few lines; anything bigger is not one. */
const maxBytes = 256 * 1024;

/**
 * Reads each of `paths`, earliest first. A file that does not exist is skipped without comment:
 * neither location is required. One that cannot be read, is too big, or is not valid is left out
 * with a problem that names it, and the others are still used, so a typo never takes beuve's own
 * servers away. Never rejects.
 */
export async function loadLanguageServersConfig(
  paths: readonly string[],
): Promise<LoadedLanguageServersConfig> {
  const layers: LanguageServersConfig[] = [];
  const problems: string[] = [];
  for (const file of paths) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error: unknown) {
      if (isMissing(error)) {
        continue;
      }
      problems.push(`${file} could not be read: ${errorFrom(error).message}`);
      continue;
    }
    if (Buffer.byteLength(text) > maxBytes) {
      problems.push(`${file} is too big to be a language server configuration.`);
      continue;
    }
    const parsed = parseLanguageServersConfig(text);
    if (parsed.ok) {
      layers.push(parsed.value);
    } else {
      problems.push(`${file}: ${parsed.error}`);
    }
  }
  return { layers, problems };
}

function isMissing(error: unknown): boolean {
  return Error.isError(error) && 'code' in error && error.code === 'ENOENT';
}
