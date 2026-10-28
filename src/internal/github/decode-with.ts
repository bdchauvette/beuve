import { z } from 'zod';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

/** `body` validated against `schema`, or zod's description of what didn't match. */
export function decodeWith<T>(schema: z.ZodType<T>, body: unknown): Result<T, string> {
  const parsed = schema.safeParse(body);
  return parsed.success ? ok(parsed.data) : err(z.prettifyError(parsed.error));
}
