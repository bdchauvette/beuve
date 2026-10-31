import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** `body` validated against `schema`, or zod's description of what didn't match. */
export function decodeWith<T>(schema: z.ZodType<T>, body: unknown): Result<T, string> {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(z.prettifyError(parsed.error));
}
