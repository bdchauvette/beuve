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
  const fields =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const [fallback] = defaultModelRegistry.entries;
  const entries: ModelEntry[] = [];
  const candidates = Array.isArray(fields['entries']) ? (fields['entries'] as unknown[]) : [];
  for (const candidate of candidates) {
    const entry = entryFrom(candidate);
    if (entry !== undefined && entries.every((known) => known.id !== entry.id)) {
      entries.push(entry);
    }
  }
  if (fallback !== undefined && entries.every((entry) => entry.id !== fallback.id)) {
    entries.unshift(fallback);
  }
  const storedRoles =
    typeof fields['roles'] === 'object' && fields['roles'] !== null
      ? (fields['roles'] as Record<string, unknown>)
      : {};
  const roles = Object.fromEntries(
    modelRoles.map((role): [ModelRole, string] => {
      const id = storedRoles[role];
      return [
        role,
        typeof id === 'string' && entries.some((entry) => entry.id === id)
          ? id
          : defaultModelRegistry.roles[role],
      ];
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
