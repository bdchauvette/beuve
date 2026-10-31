import path from 'node:path';

import { z } from 'zod';

import { hasControlCharacters } from '#x/text/has-control-characters.ts';

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  }, 'must be an http or https URL without credentials');

const absolutePath = text(4096).refine((value) => {
  return path.isAbsolute(value);
}, 'must be an absolute path');

const installed = z.strictObject({
  source: z.literal('installed'),
  path: absolutePath.optional(),
});

const executable = z.discriminatedUnion('source', [
  installed,
  z.strictObject({ source: z.literal('bundled') }),
]);

const common = {
  id: text(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/u, 'lowercase letters, digits and dashes')
    .optional(),
  label: text(80),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  contextWindowTokens: z.number().int().min(1024).max(10_000_000).optional(),
};

/**
 * A model registry entry as the Settings window sends it, or as `settings.json` holds it
 * (ADR 0070), validated in main: bounded text without control characters, an absolute
 * executable path, an http(s) base URL without credentials in it, and nothing unknown.
 */
export const modelEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('claude-code-cli'), model: text(200).optional() }),
  z.strictObject({
    ...common,
    kind: z.literal('claude-agent-sdk'),
    model: text(200).optional(),
    executable,
  }),
  z.strictObject({
    ...common,
    kind: z.literal('openai-compatible'),
    model: text(200),
    baseUrl: httpUrl,
    tools: z.boolean(),
  }),
]);

function text(max: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => {
      return !hasControlCharacters(value);
    }, 'control characters are not allowed');
}
