import { randomUUID } from 'node:crypto';

import type {
  IpcResult,
  ListRemoteModelsRequest,
  ModelEntryInput,
  ModelEntryView,
  ModelRegistryView,
  ModelRole,
  ModelTestView,
  RemoteModelsView,
  SetModelKeyRequest,
} from '#contract/ipc-contract.ts';
import { listOpenAiCompatibleModels } from '#internal/llm/list-open-ai-compatible-models.ts';
import { isLoopbackUrl } from '#x/net/is-loopback-url.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { checkClaudeCodeVersion } from './check-claude-code-version.ts';
import type { ModelRegistryStore } from './create-model-registry-store.ts';
import type { SecretStore } from './create-secret-store.ts';
import { defaultModelRegistry } from './default-model-registry.ts';
import { describeModelError } from './describe-model-error.ts';
import type { ModelEntry, ModelRegistry } from './model-registry.ts';

/** The Settings window's model registry (ADR 0070); every input is already validated for shape. */
export interface ModelServices {
  readonly list: () => Promise<IpcResult<ModelRegistryView>>;
  /** Adds an entry (no `id`) or replaces one; the default entry keeps its kind. */
  readonly save: (entry: ModelEntryInput) => Promise<IpcResult<ModelRegistryView>>;
  /** Removes an entry and its key; roles that used it fall back to the default entry. */
  readonly remove: (id: string) => Promise<IpcResult<ModelRegistryView>>;
  readonly setRole: (role: ModelRole, id: string) => Promise<IpcResult<ModelRegistryView>>;
  /** Write-only: encrypts and stores the key; nothing returned ever contains it. */
  readonly setKey: (request: SetModelKeyRequest) => Promise<IpcResult<ModelRegistryView>>;
  readonly removeKey: (id: string) => Promise<IpcResult<ModelRegistryView>>;
  readonly listRemote: (request: ListRemoteModelsRequest) => Promise<IpcResult<RemoteModelsView>>;
  /** One tiny request through the chat's queue (ADR 0057), timed. */
  readonly test: (id: string) => Promise<IpcResult<ModelTestView>>;
}

export interface ModelServicesOptions {
  readonly registry: ModelRegistryStore;
  readonly secrets: SecretStore;
  /** Runs the test request; the chat services queue it like a question. */
  readonly testModel: (id: string) => Promise<ModelTestView>;
  readonly hasBundledClaudeCode: boolean;
  /** Ids for new entries; defaults to random ones. */
  readonly newId?: () => string;
  readonly logger: Logger;
}

const listTimeout = Temporal.Duration.from({ seconds: 10 });

/**
 * The model registry behind the Settings window's channels (ADR 0070): main owns it, stores it
 * in `settings.json` and keeps API keys in the encrypted secret store, which no view ever reads
 * back (a view says only whether a key is set). An Agent SDK entry with an installed `claude`
 * path is checked by running `<path> --version` before it is saved. A model list request uses an
 * entry's key only for that entry's own base URL, so a typed URL can't collect the key.
 */
export function createModelServices(options: ModelServicesOptions): ModelServices {
  const { registry, secrets, logger } = options;
  const newId = options.newId ?? ((): string => randomUUID().slice(0, 8));
  const [defaultEntry] = defaultModelRegistry.entries;
  const defaultId = defaultEntry?.id ?? 'claude-code';

  const view = async (current: ModelRegistry): Promise<ModelRegistryView> => {
    return {
      entries: await Promise.all(
        current.entries.map(async (entry): Promise<ModelEntryView> => {
          return {
            ...withoutKeyRef(entry),
            hasApiKey: entry.apiKeyRef !== undefined && (await secrets.has(entry.apiKeyRef)),
            isRemote: entry.kind === 'openai-compatible' && !isLoopbackUrl(entry.baseUrl),
            isDefault: entry.id === defaultId,
          };
        }),
      ),
      roles: current.roles,
      keyStorage: await secrets.status(),
      hasBundledClaudeCode: options.hasBundledClaudeCode,
    };
  };

  const changed = async (
    change: (current: ModelRegistry) => Result<ModelRegistry, string>,
  ): Promise<IpcResult<ModelRegistryView>> => {
    const updated = await registry.update(change);
    if (updated.ok) {
      return ok(await view(updated.value));
    }
    if (updated.error.startsWith('no model')) {
      return err({ code: 'not-found', message: updated.error });
    }
    return err({ code: 'refused', message: updated.error });
  };

  return {
    list: async (): Promise<IpcResult<ModelRegistryView>> => {
      return ok(await view(await registry.read()));
    },

    save: async (input): Promise<IpcResult<ModelRegistryView>> => {
      if (
        input.kind === 'claude-agent-sdk' &&
        input.executable.source === 'installed' &&
        input.executable.path !== undefined
      ) {
        const checked = await checkClaudeCodeVersion(input.executable.path);
        if (!checked.ok) {
          return err({ code: 'refused', message: describeModelError(checked.error) });
        }
      }
      const id = input.id ?? `${idPrefixOf(input.kind)}-${newId()}`;
      logger.info('model entry saved', { id, kind: input.kind });
      return changed((current) => {
        const existing = current.entries.find((entry) => entry.id === id);
        if (existing === undefined && input.id !== undefined) {
          return err(`no model named ${id}`);
        }
        if (id === defaultId && input.kind !== 'claude-code-cli') {
          return err('The built-in Claude Code entry keeps its kind; add a new model instead.');
        }
        const entry: ModelEntry = {
          ...input,
          id,
          ...(existing?.apiKeyRef !== undefined &&
            input.kind !== 'claude-code-cli' && {
              apiKeyRef: existing.apiKeyRef,
            }),
        };
        if (existing === undefined) {
          return ok({ ...current, entries: [...current.entries, entry] });
        }
        return ok({
          ...current,
          entries: current.entries.map((candidate) => {
            if (candidate.id === id) {
              return entry;
            }
            return candidate;
          }),
        });
      });
    },

    remove: async (id): Promise<IpcResult<ModelRegistryView>> => {
      if (id === defaultId) {
        return err({
          code: 'refused',
          message: 'The built-in Claude Code entry cannot be removed.',
        });
      }
      const result = await changed((current) => {
        if (current.entries.every((entry) => entry.id !== id)) {
          return err(`no model named ${id}`);
        }
        const roles = Object.fromEntries(
          Object.entries(current.roles).map(([role, used]) => {
            if (used === id) {
              return [role, defaultId];
            }
            return [role, used];
          }),
        ) as Record<ModelRole, string>;
        return ok({ entries: current.entries.filter((entry) => entry.id !== id), roles });
      });
      if (result.ok) {
        await secrets.remove(keyRefFor(id));
      }
      return result;
    },

    setRole: async (role, id): Promise<IpcResult<ModelRegistryView>> => {
      return changed((current) => {
        if (current.entries.some((entry) => entry.id === id)) {
          return ok({ ...current, roles: { ...current.roles, [role]: id } });
        }
        return err(`no model named ${id}`);
      });
    },

    setKey: async ({ id, apiKey }): Promise<IpcResult<ModelRegistryView>> => {
      const current = await registry.read();
      const entry = current.entries.find((candidate) => candidate.id === id);
      if (entry === undefined) {
        return err({ code: 'not-found', message: `no model named ${id}` });
      }
      if (entry.kind === 'claude-code-cli') {
        return err({
          code: 'refused',
          message: 'Claude Code uses your own login; it takes no key.',
        });
      }
      const stored = await secrets.set({ ref: keyRefFor(id), secret: apiKey });
      if (!stored.ok) {
        return err({ code: 'unsupported', message: stored.error });
      }
      logger.info('model key stored', { id });
      return changed((latest) => {
        return ok({
          ...latest,
          entries: latest.entries.map((candidate) => {
            if (candidate.id === id) {
              return { ...candidate, apiKeyRef: keyRefFor(id) };
            }
            return candidate;
          }),
        });
      });
    },

    removeKey: async (id): Promise<IpcResult<ModelRegistryView>> => {
      await secrets.remove(keyRefFor(id));
      logger.info('model key removed', { id });
      return changed((current) => {
        if (current.entries.some((entry) => entry.id === id)) {
          return ok({
            ...current,
            entries: current.entries.map((entry) => {
              if (entry.id === id) {
                return withoutKeyRef(entry);
              }
              return entry;
            }),
          });
        }
        return err(`no model named ${id}`);
      });
    },

    listRemote: async ({ baseUrl, id }): Promise<IpcResult<RemoteModelsView>> => {
      const current = await registry.read();
      const entry = current.entries.find((candidate) => candidate.id === id);
      let apiKey: string | undefined;
      if (
        entry?.kind === 'openai-compatible' &&
        entry.baseUrl === baseUrl &&
        entry.apiKeyRef !== undefined
      ) {
        apiKey = await secrets.get(entry.apiKeyRef);
      }
      const listed = await listOpenAiCompatibleModels({
        baseUrl,
        timeout: listTimeout,
        ...(apiKey !== undefined && { apiKey }),
      });
      if (listed.ok) {
        return ok({ models: listed.value });
      }
      return err({ code: 'refused', message: describeModelError(listed.error) });
    },

    test: async (id): Promise<IpcResult<ModelTestView>> => {
      const current = await registry.read();
      if (current.entries.every((entry) => entry.id !== id)) {
        return err({ code: 'not-found', message: `no model named ${id}` });
      }
      return ok(await options.testModel(id));
    },
  };
}

function keyRefFor(id: string): string {
  return `model:${id}`;
}

/** A registry entry as stored: the input it was saved from, with its id. */
type StoredEntry = ModelEntryInput & Pick<ModelEntry, 'id'>;

function withoutKeyRef(entry: ModelEntry): StoredEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== 'apiKeyRef'),
  ) as StoredEntry;
}

/** A new entry's id prefix: `openai-` for OpenAI-compatible models, else `claude-`. */
function idPrefixOf(kind: ModelEntryInput['kind']): string {
  if (kind === 'openai-compatible') {
    return 'openai';
  }
  return 'claude';
}
