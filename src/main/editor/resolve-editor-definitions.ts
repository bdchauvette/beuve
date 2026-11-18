import type { EditorDefinition } from './editor-definitions.ts';
import { editorEntrySchema } from './editor-entry-schema.ts';
import type { EditorEntrySettings } from './editor-entry-schema.ts';
import { isEditorId } from './is-editor-id.ts';

/** Beuve's own editors and the `editors` value of `settings.json`, as read (anything at all). */
export interface EditorDefinitionSources {
  readonly builtins: readonly EditorDefinition[];
  readonly config: unknown;
}

/** The editors beuve knows, and one sentence per entry of the configuration that was left out. */
export interface ResolvedEditorDefinitions {
  readonly definitions: readonly EditorDefinition[];
  readonly problems: readonly string[];
}

/** What a new editor's arguments are when its entry names none: just the file. */
const defaultArgs: readonly string[] = Object.freeze(['{file}']);

/**
 * Merges the reviewer's `editors` map (ADR 0139) over the built-ins: an entry with a built-in id
 * changes the fields it names (`enabled: false` removes it, `command` replaces where beuve looks
 * for it, including the macOS app fallback), and a new id adds an editor, which needs `command`.
 * Built-ins keep their order and new editors follow in the file's order. An invalid entry is left
 * out and reported; it never makes the others fail. Pure.
 */
export function resolveEditorDefinitions({
  builtins,
  config,
}: EditorDefinitionSources): ResolvedEditorDefinitions {
  if (config === undefined) {
    return { definitions: builtins, problems: [] };
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return {
      definitions: builtins,
      problems: ['editors: expected an object of editors by id, such as { "helix": { … } }'],
    };
  }
  const problems: string[] = [];
  const entries = new Map<string, EditorEntrySettings>();
  for (const [id, value] of Object.entries(config)) {
    if (!isEditorId(id)) {
      problems.push(
        `editors.${id}: an editor id is lowercase letters, digits and dashes, starting with a letter`,
      );
      continue;
    }
    const parsed = editorEntrySchema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => {
        return `${['editors', id, ...issue.path.map(String)].join('.')}: ${issue.message}`;
      });
      problems.push(issues.join('; '));
      continue;
    }
    entries.set(id, parsed.data);
  }
  const definitions = builtins.flatMap((builtin) => {
    const entry = entries.get(builtin.id);
    if (entry === undefined) {
      return [builtin];
    }
    if (entry.enabled === false) {
      return [];
    }
    return [changed(builtin, entry)];
  });
  const builtinIds = new Set(builtins.map((builtin) => builtin.id));
  for (const [id, entry] of entries) {
    if (builtinIds.has(id) || entry.enabled === false) {
      continue;
    }
    if (entry.command === undefined) {
      problems.push(`editors.${id}: a new editor needs a "command"`);
      continue;
    }
    definitions.push({
      id,
      name: entry.name ?? id,
      ...placesOf(entry.command),
      appBundles: [],
      args: entry.args ?? defaultArgs,
      origin: 'custom',
    });
  }
  return { definitions, problems };
}

/** A built-in with the fields an entry names replaced; any field but `enabled` makes it custom. */
function changed(builtin: EditorDefinition, entry: EditorEntrySettings): EditorDefinition {
  const isChanged = Object.entries(entry).some(([key, value]) => {
    return key !== 'enabled' && value !== undefined;
  });
  let definition: EditorDefinition = builtin;
  if (isChanged) {
    definition = { ...definition, origin: 'custom' };
  }
  if (entry.name !== undefined) {
    definition = { ...definition, name: entry.name };
  }
  if (entry.args !== undefined) {
    definition = { ...definition, args: entry.args };
  }
  if (entry.command !== undefined) {
    const { id, name, args, origin } = definition;
    definition = { id, name, args, origin, ...placesOf(entry.command), appBundles: [] };
  }
  return definition;
}

/** Where a command is looked for. */
interface CommandPlaces {
  readonly executables: readonly string[];
  readonly knownPaths: readonly string[];
}

/** A path (absolute or under `~/`) is the one place to look; a bare name is looked up on PATH. */
function placesOf(command: string): CommandPlaces {
  if (command.includes('/')) {
    return { executables: [], knownPaths: [command] };
  }
  return { executables: [command], knownPaths: [] };
}
