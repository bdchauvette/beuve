import { z } from 'zod';

import { hasControlCharacters } from '#x/text/has-control-characters.ts';

function text(max: number): z.ZodString {
  return z.string().min(1).max(max);
}

function plainText(max: number): z.ZodType<string> {
  return text(max).refine((value) => {
    return !hasControlCharacters(value);
  }, 'no control characters');
}

const serverId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/u, 'lowercase letters, digits and dashes, starting with a letter');
const extension = z
  .string()
  .regex(/^\.[a-z0-9][a-z0-9._+-]{0,31}$/iu, 'a file extension with its dot, such as ".go"');
const environmentName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u, 'a variable name such as GOPATH');
const markerName = plainText(255).refine((value) => {
  return !value.includes('/') && !value.includes('\\') && value !== '..';
}, 'a file or directory name, not a path');

/**
 * One server's settings (ADR 0111). Every field is optional, because a built-in server's entry
 * only changes what it names; a server of the reviewer's own needs `command` and `extensions`,
 * which resolving checks once all layers are merged.
 */
const serverSettings = z.strictObject({
  enabled: z.boolean().optional(),
  command: plainText(4096).optional(),
  args: z.array(z.string().max(4096)).max(100).optional(),
  /** File extension → LSP language id, such as `".go": "go"`. */
  extensions: z.record(extension, plainText(64)).optional(),
  rootMarkers: z.array(markerName).max(20).optional(),
  initializationOptions: z.unknown().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  env: z.record(environmentName, z.string().max(8192)).optional(),
  inheritEnv: z.array(environmentName).max(100).optional(),
  /** `path` (the default) looks the program up on `PATH`; `project` runs one from the checkout. */
  source: z.enum(['path', 'project']).optional(),
  diagnosticsQuietMs: z.number().int().min(0).max(30_000).optional(),
});

const servers = z.record(serverId, serverSettings);

/** An override applies to a repository the match names: a path glob of the clone, or a remote. */
const match = z.union([
  z.strictObject({ path: plainText(4096) }),
  z.strictObject({ remote: plainText(512) }),
]);

/**
 * The shape of `language-servers.json` (ADR 0111), validated strictly: unknown keys and wrong
 * types are errors, as for the model registry (ADR 0070).
 */
export const languageServersConfigSchema = z.strictObject({
  $schema: z.string().max(2048).optional(),
  servers: servers.optional(),
  overrides: z.array(z.strictObject({ match, servers })).max(200).optional(),
});

export type LanguageServersConfig = z.infer<typeof languageServersConfigSchema>;
export type ServerSettings = z.infer<typeof serverSettings>;
export type OverrideMatch = z.infer<typeof match>;
