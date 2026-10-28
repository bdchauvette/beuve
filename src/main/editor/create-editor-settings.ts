import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EditorId } from '#contract/ipc-contract.ts';

import { editorDefinitions } from './editor-definitions.ts';

/** The reviewer's editor choice, persisted as `{ "preferredEditor": "zed" }` (ADR 0033). */
export interface EditorSettings {
  readonly read: () => Promise<EditorId | undefined>;
  readonly write: (editorId: EditorId) => Promise<void>;
}

/**
 * Stores the preference in the JSON file at `filePath` (`<userData>/settings.json`), keeping any
 * other keys; an unreadable or malformed file reads as unset. Without a path, in memory.
 */
export function createEditorSettings(filePath?: string): EditorSettings {
  let remembered: EditorId | undefined;
  return {
    read: async (): Promise<EditorId | undefined> => {
      const stored = filePath === undefined ? undefined : await readObject(filePath);
      return filePath === undefined ? remembered : toEditorId(stored?.['preferredEditor']);
    },
    write: async (editorId): Promise<void> => {
      remembered = editorId;
      if (filePath === undefined) {
        return;
      }
      const next = { ...(await readObject(filePath)), preferredEditor: editorId };
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, undefined, 2)}\n`);
      await rename(temporary, filePath);
    },
  };
}

async function readObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toEditorId(value: unknown): EditorId | undefined {
  return editorDefinitions.find((definition) => definition.id === value)?.id;
}
