import type { Result } from '#x/result/result.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';
import { defaultModelRegistry } from './default-model-registry.ts';
import type { ModelRegistry } from './model-registry.ts';
import { modelRegistryFrom } from './model-registry-from.ts';

/** The model registry in `settings.json` (ADR 0070). */
export interface ModelRegistryStore {
  readonly read: () => Promise<ModelRegistry>;
  /**
   * Applies `change` to the current registry and stores what it returns, or nothing when it
   * fails. Changes to one file run one after another.
   */
  readonly update: <E>(
    change: (registry: ModelRegistry) => Result<ModelRegistry, E>,
  ) => Promise<Result<ModelRegistry, E>>;
}

/**
 * Keeps the registry under the `models` key of `settingsPath` (ADR 0033's settings file), or in
 * memory without one. Reads are lenient ({@link modelRegistryFrom}); writes keep every other key.
 */
export function createModelRegistryStore(settingsPath?: string): ModelRegistryStore {
  let memory: ModelRegistry = defaultModelRegistry;
  return {
    read: async (): Promise<ModelRegistry> => {
      if (settingsPath === undefined) {
        return memory;
      }
      const settings = await readSettingsFile(settingsPath);
      return modelRegistryFrom(settings['models']);
    },
    update: async <E>(
      change: (registry: ModelRegistry) => Result<ModelRegistry, E>,
    ): Promise<Result<ModelRegistry, E>> => {
      if (settingsPath === undefined) {
        const changed = change(memory);
        memory = changed.ok ? changed.value : memory;
        return changed;
      }
      let outcome: Result<ModelRegistry, E> | undefined;
      await updateSettingsFile(settingsPath, (current) => {
        outcome = change(modelRegistryFrom(current['models']));
        return outcome.ok
          ? { ...current, models: { entries: outcome.value.entries, roles: outcome.value.roles } }
          : { ...current };
      });
      // updateSettingsFile always calls the function; this only satisfies the type checker.
      return outcome ?? change(memory);
    },
  };
}
