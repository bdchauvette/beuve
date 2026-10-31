import { modelRoles } from '#contract/model-roles.ts';
import type { ModelRole } from '#contract/ipc-contract.ts';

import { defaultModelRegistry } from './default-model-registry.ts';
import { modelEntryInputFrom } from './model-entry-input-from.ts';
import { modelEntrySchema } from './model-entry-schema.ts';
import type { ModelEntry, ModelRegistry } from './model-registry.ts';

/**
 * The registry stored under `models` in `settings.json` (ADR 0070), read leniently so a bad file
 * never blocks the chat: entries that don't validate or repeat an id are skipped, the default
 * entry is put back first when missing, and a role naming no entry falls back to it.
 */
export function modelRegistryFrom(stored: unknown): ModelRegistry {
  const fields = recordOf(stored);
  const [fallback] = defaultModelRegistry.entries;
  const entries: ModelEntry[] = [];
  let candidates: unknown[] = [];
  if (Array.isArray(fields['entries'])) {
    candidates = fields['entries'] as unknown[];
  }
  for (const candidate of candidates) {
    const entry = entryFrom(candidate);
    if (entry !== undefined && entries.every((known) => known.id !== entry.id)) {
      entries.push(entry);
    }
  }
  if (fallback !== undefined && entries.every((entry) => entry.id !== fallback.id)) {
    entries.unshift(fallback);
  }
  const storedRoles = recordOf(fields['roles']);
  const roles = Object.fromEntries(
    modelRoles.map((role): [ModelRole, string] => {
      const id = storedRoles[role];
      if (typeof id === 'string' && entries.some((entry) => entry.id === id)) {
        return [role, id];
      }
      return [role, defaultModelRegistry.roles[role]];
    }),
  ) as Record<ModelRole, string>;
  return { entries, roles };
}

function entryFrom(candidate: unknown): ModelEntry | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined;
  }
  const { apiKeyRef, ...rest } = candidate as Record<string, unknown>;
  const parsed = modelEntrySchema.safeParse(rest);
  if (!parsed.success || parsed.data.id === undefined) {
    return undefined;
  }
  const entry = { ...modelEntryInputFrom(parsed.data), id: parsed.data.id };
  if (typeof apiKeyRef === 'string' && apiKeyRef !== '') {
    return { ...entry, apiKeyRef };
  }
  return entry;
}

/** `value`'s fields when it is an object, else none. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}
