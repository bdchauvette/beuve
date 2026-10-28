import type { EditorId } from '#contract/ipc-contract.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

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
      const stored = filePath === undefined ? undefined : await readSettingsFile(filePath);
      return filePath === undefined ? remembered : toEditorId(stored?.['preferredEditor']);
    },
    write: async (editorId): Promise<void> => {
      remembered = editorId;
      if (filePath === undefined) {
        return;
      }
      await updateSettingsFile(filePath, (current) => ({ ...current, preferredEditor: editorId }));
    },
  };
}

function toEditorId(value: unknown): EditorId | undefined {
  return editorDefinitions.find((definition) => definition.id === value)?.id;
}
