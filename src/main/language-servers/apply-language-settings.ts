import type { ServerDefinition } from '#internal/lsp/server-definition.ts';

import type { LanguageSettings } from './language-servers-config-schema.ts';

export interface ApplyLanguageSettingsOptions {
  readonly definitions: readonly ServerDefinition[];
  /** Settings by LSP language id, later config already merged over earlier. */
  readonly languages: ReadonlyMap<string, LanguageSettings>;
}

export interface LanguageNarrowing {
  readonly definitions: readonly ServerDefinition[];
  /** What a language's list got wrong, one sentence each. */
  readonly problems: readonly string[];
}

/**
 * Narrows which servers serve each language (ADR 0111), as Zed's per-language `language_servers`
 * does. For a language, `enabled: false` removes it from every server. A `servers` list keeps the
 * servers it names, and they are tried in its order: `!name` leaves one out, and `...` stands for
 * the servers the list does not name. A list of only `!name` entries keeps the rest, as if it
 * ended in `...`. A server left with no language is dropped. Order is among the servers' own
 * places: the listed servers swap into the slots they already hold, so another language's order
 * is not disturbed. A language nothing serves is ignored; a name that does not serve the language
 * is a problem. Only languages change, never a server's origin. Pure.
 */
export function applyLanguageSettings(options: ApplyLanguageSettingsOptions): LanguageNarrowing {
  let current = [...options.definitions];
  const problems: string[] = [];
  for (const [language, settings] of options.languages) {
    const serving = current.filter((definition) => isServing(definition, language));
    if (serving.length === 0) {
      continue;
    }
    const chosen = chosenServers({ language, settings, serving, problems });
    current = narrowed({ current, chosen, language });
  }
  return { definitions: current, problems };
}

interface ChoiceOptions {
  readonly language: string;
  readonly settings: LanguageSettings;
  readonly serving: readonly ServerDefinition[];
  readonly problems: string[];
}

function chosenServers({
  language,
  settings,
  serving,
  problems,
}: ChoiceOptions): ServerDefinition[] {
  if (settings.enabled === false) {
    return [];
  }
  if (settings.servers === undefined) {
    return [...serving];
  }
  const entries = settings.servers;
  const excluded = new Set(
    entries.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1)),
  );
  const named = new Set(
    entries.filter((entry) => {
      return !entry.startsWith('!') && entry !== '...';
    }),
  );
  const byId = new Map(
    serving.map((definition) => {
      return [definition.id, definition];
    }),
  );
  const mentioned = [...named, ...excluded];
  for (const id of mentioned) {
    if (!byId.has(id)) {
      problems.push(
        `The ${id} language server does not serve ${language}, so its entry in the ${language} list does nothing.`,
      );
    }
  }
  const rest = serving.filter((definition) => {
    return !named.has(definition.id) && !excluded.has(definition.id);
  });
  const hasRest = entries.includes('...') || named.size === 0;
  const ordered: ServerDefinition[] = [];
  const placeRest = (): void => {
    ordered.push(...rest);
  };
  for (const entry of entries) {
    if (entry === '...') {
      placeRest();
      continue;
    }
    const definition = byId.get(entry);
    if (definition !== undefined && !excluded.has(entry)) {
      ordered.push(definition);
    }
  }
  if (hasRest && !entries.includes('...')) {
    placeRest();
  }
  return ordered;
}

interface NarrowOptions {
  readonly current: readonly ServerDefinition[];
  readonly chosen: readonly ServerDefinition[];
  readonly language: string;
}

function narrowed({ current, chosen, language }: NarrowOptions): ServerDefinition[] {
  const chosenIds = new Set(chosen.map((definition) => definition.id));
  const result: ServerDefinition[] = [];
  const queue = [...chosen];
  for (const definition of current) {
    if (!isServing(definition, language)) {
      result.push(definition);
    } else if (chosenIds.has(definition.id)) {
      const next = queue.shift();
      if (next !== undefined) {
        result.push(next);
      }
    } else {
      const without = withoutLanguage(definition, language);
      if (Object.keys(without.languageIds).length > 0) {
        result.push(without);
      }
    }
  }
  return result;
}

function isServing(definition: ServerDefinition, language: string): boolean {
  return Object.values(definition.languageIds).includes(language);
}

function withoutLanguage(definition: ServerDefinition, language: string): ServerDefinition {
  const languageIds = Object.fromEntries(
    Object.entries(definition.languageIds).filter(([, id]) => id !== language),
  );
  return { ...definition, languageIds };
}
