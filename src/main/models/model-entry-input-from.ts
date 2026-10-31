import type { z } from 'zod';

import type { ModelEntryInput } from '#contract/ipc-contract.ts';

import type { modelEntrySchema } from './model-entry-schema.ts';

/** A validated entry without the `undefined` fields zod leaves for absent optional ones. */
export function modelEntryInputFrom(parsed: z.infer<typeof modelEntrySchema>): ModelEntryInput {
  const present = Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined),
  );
  if (parsed.kind === 'claude-agent-sdk') {
    const { executable } = parsed;
    if (executable.source === 'installed' && executable.path !== undefined) {
      return {
        ...present,
        executable: { source: 'installed', path: executable.path },
      } as ModelEntryInput;
    }
    return { ...present, executable: { source: executable.source } } as ModelEntryInput;
  }
  return present as ModelEntryInput;
}
