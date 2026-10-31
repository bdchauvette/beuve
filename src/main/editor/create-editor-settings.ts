import type { EditorId } from '#contract/ipc-contract.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

import { editorDefinitions } from './editor-definitions.ts';

/**
 * The reviewer's editor choice and review-edits branch prefix, persisted as
 * `{ "preferredEditor": "zed", "reviewEditsPrefix": "review/" }` (ADR 0033, 0088).
 */
export interface EditorSettings {
  readonly read: () => Promise<EditorId | undefined>;
  readonly write: (editorId: EditorId) => Promise<void>;
  /** The prefix of review-edits branch names; `review/` until the reviewer sets one. */
  readonly readReviewEditsPrefix: () => Promise<string>;
  readonly writeReviewEditsPrefix: (prefix: string) => Promise<void>;
}

/** The review-edits branch prefix until the reviewer chooses another (ADR 0088). */
const defaultReviewEditsPrefix = 'review/';

/**
 * Stores the preferences in the JSON file at `filePath` (`<userData>/settings.json`), keeping any
 * other keys; an unreadable or malformed file reads as unset. Without a path, in memory.
 */
export function createEditorSettings(filePath?: string): EditorSettings {
  let remembered: EditorId | undefined;
  let rememberedPrefix = defaultReviewEditsPrefix;
  return {
    read: async (): Promise<EditorId | undefined> => {
      if (filePath === undefined) {
        return remembered;
      }
      const stored = await readSettingsFile(filePath);
      return editorIdFrom(stored['preferredEditor']);
    },
    write: async (editorId): Promise<void> => {
      remembered = editorId;
      if (filePath === undefined) {
        return;
      }
      await updateSettingsFile(filePath, (current) => {
        return { ...current, preferredEditor: editorId };
      });
    },
    readReviewEditsPrefix: async (): Promise<string> => {
      if (filePath === undefined) {
        return rememberedPrefix;
      }
      const stored = await readSettingsFile(filePath);
      const prefix = stored['reviewEditsPrefix'];
      if (typeof prefix === 'string') {
        return prefix;
      }
      return defaultReviewEditsPrefix;
    },
    writeReviewEditsPrefix: async (prefix): Promise<void> => {
      rememberedPrefix = prefix;
      if (filePath === undefined) {
        return;
      }
      await updateSettingsFile(filePath, (current) => {
        return { ...current, reviewEditsPrefix: prefix };
      });
    },
  };
}

function editorIdFrom(value: unknown): EditorId | undefined {
  return editorDefinitions.find((definition) => definition.id === value)?.id;
}
