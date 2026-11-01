import path from 'node:path';

import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { InstallConfig, InstallStep } from './install-config.ts';

const skippable = z.enum([
  'node',
  'python',
  'php',
  'ruby',
  'go',
  'rust',
  'pnpm',
  'bun',
  'yarn-berry',
  'yarn-classic',
  'npm',
  'uv',
  'poetry',
  'pip',
  'composer',
  'bundler',
  'cargo',
]);

const step = z.strictObject({
  run: z.array(z.string().min(1).max(4096)).min(1).max(256),
  cwd: z
    .string()
    .max(4096)
    .refine(isContainedPath, { message: 'must be a relative path that stays inside the checkout' })
    .optional(),
  env: z
    .record(z.string().regex(/^[A-Za-z_]\w*$/u, 'a variable name'), z.string().max(65_536))
    .optional(),
});

const schema = z.strictObject({
  $schema: z.string().optional(),
  install: z
    .strictObject({
      skip: z.array(skippable).max(32).optional(),
      steps: z.array(step).max(32).optional(),
      hook: z.enum(['after', 'instead']).optional(),
      timeoutSeconds: z.number().int().min(10).max(7200).optional(),
    })
    .optional(),
});

/** A configuration's JSON text, and what errors call it (`.beuve/config.json`, `Settings`). */
export interface ConfigText {
  readonly text: string;
  readonly source: string;
}

/**
 * Reads `.beuve/config.json` (or the Settings override, same shape) with `JSON.parse` and checks
 * it (ADR 0092). Unknown keys are errors, so a typo is reported rather than ignored. The error
 * names `source` and the failing field: `.beuve/config.json: install.steps.0.cwd: must be …`.
 */
export function parseInstallConfig({ text, source }: ConfigText): Result<InstallConfig, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    return err(`${source}: not JSON (${(error as SyntaxError).message})`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue?.path.map(String).join('.') ?? '';
    let field = '';
    if (where !== '') {
      field = `${where}: `;
    }
    return err(`${source}: ${field}${issue?.message ?? 'invalid'}`);
  }
  const install = parsed.data.install ?? {};
  const config: InstallConfig = {
    ...(install.skip !== undefined && { skip: install.skip }),
    ...(install.steps !== undefined && { steps: install.steps.map((entry) => stepFrom(entry)) }),
    ...(install.hook !== undefined && { hook: install.hook }),
    ...(install.timeoutSeconds !== undefined && { timeoutSeconds: install.timeoutSeconds }),
  };
  return ok(config);
}

function stepFrom(entry: z.infer<typeof step>): InstallStep {
  let cwd = path.posix.normalize(entry.cwd ?? '.');
  if (cwd === '.') {
    cwd = '';
  }
  return { run: entry.run, cwd, env: entry.env ?? {} };
}

function isContainedPath(value: string): boolean {
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    return false;
  }
  const normal = path.posix.normalize(value);
  return normal !== '..' && !normal.startsWith('../');
}
