import { z } from 'zod';

/**
 * The JSON Schema of a zod schema for Claude Code's structured output, without the `$schema`
 * dialect key it doesn't need; `undefined` when the schema has no JSON Schema form.
 */
export function jsonSchemaFrom(schema: z.ZodType): Record<string, unknown> | undefined {
  try {
    const json = Object.entries(z.toJSONSchema(schema)).filter(([key]) => key !== '$schema');
    return Object.fromEntries(json);
  } catch {
    return undefined;
  }
}
