import { z } from 'zod';

import { hasControlCharacters } from '#x/text/has-control-characters.ts';

const anyPlaceholder = /\{(?<name>[^{}]*)\}/gu;
const knownPlaceholders: ReadonlySet<string> = new Set(['file', 'line', 'column']);

function plainText(max: number): z.ZodType<string> {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => {
      return !hasControlCharacters(value);
    }, 'no control characters');
}

/** A program name looked up on PATH, an absolute path, or a path under `~/`. */
const command = plainText(4096).refine((value) => {
  return value.startsWith('/') || value.startsWith('~/') || !value.includes('/');
}, 'an absolute path, a path starting with ~/, or a program name found on PATH');

const argument = z
  .string()
  .max(4096)
  .refine((value) => {
    return !hasControlCharacters(value);
  }, 'no control characters')
  .refine((value) => {
    return value
      .matchAll(anyPlaceholder)
      .every((match) => knownPlaceholders.has(match.groups?.['name'] ?? ''));
  }, 'only {file}, {line} and {column} are filled in');

const args = z
  .array(argument)
  .min(1)
  .max(50)
  .refine((values) => {
    return values.some((value) => value.includes('{file}'));
  }, 'one argument must hold {file}');

/**
 * One entry of `editors` in `settings.json` (ADR 0139), validated strictly: unknown keys and wrong
 * types are errors. Every field is optional because an entry for a built-in editor only changes
 * what it names; a new editor needs `command`, which resolving checks.
 */
export const editorEntrySchema = z.strictObject({
  enabled: z.boolean().optional(),
  name: plainText(60).optional(),
  command: command.optional(),
  args: args.optional(),
});

export type EditorEntrySettings = z.infer<typeof editorEntrySchema>;
