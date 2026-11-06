import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { languageServersConfigSchema } from './language-servers-config-schema.ts';
import type { LanguageServersConfig } from './language-servers-config-schema.ts';

/**
 * Parses the text of a `language-servers.json`. The error is a sentence about what is wrong, for
 * the reviewer (the path of the first bad key and what it expected). Plain JSON, no comments.
 */
export function parseLanguageServersConfig(text: string): Result<LanguageServersConfig, string> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err('it is not valid JSON');
  }
  const parsed = languageServersConfigSchema.safeParse(json);
  if (!parsed.success) {
    return err(z.prettifyError(parsed.error));
  }
  return ok(parsed.data);
}
