import type { EditorId } from '#contract/ipc-contract.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

import { isEditorId } from './is-editor-id.ts';

/**
 * The reviewer's editor choice, their own editors and the review-edits branch prefix, persisted as
 * `{ "preferredEditor": "zed", "editors": { … }, "reviewEditsPrefix": "review/" }` (ADR 0033,
 * 0088, 0140). Beuve writes `preferredEditor` and `reviewEditsPrefix`; `editors` is the
 * reviewer's to edit by hand, and beuve only reads it.
 */
export interface EditorSettings {
  /** The stored choice and the raw `editors` value, from one read of the file. */
  readonly readEditorConfig: () => Promise<EditorConfigSource>;
  readonly write: (editorId: EditorId) => Promise<void>;
  /** The prefix of review-edits branch names; `review/` until the reviewer sets one. */
  readonly readReviewEditsPrefix: () => Promise<string>;
  readonly writeReviewEditsPrefix: (prefix: string) => Promise<void>;
  /** The settings file, absent when the settings live in memory. */
  readonly filePath?: string;
}

/** What `settings.json` says about editors: a well-formed choice, and `editors` unvalidated. */
export interface EditorConfigSource {
  readonly preferred: EditorId | undefined;
  readonly editors: unknown;
}

/** The review-edits branch prefix until the reviewer chooses another (ADR 0088). */
const defaultReviewEditsPrefix = 'review/';

/**
 * Stores the preferences in the JSON file at `filePath` (`<userData>/settings.json`), keeping any
 * other keys; an unreadable or malformed file reads as unset. Without a path, in memory, with no
 * editors of the reviewer's own.
 */
export function createEditorSettings(filePath?: string): EditorSettings {
  let remembered: EditorId | undefined;
  let rememberedPrefix = defaultReviewEditsPrefix;
  return {
    ...(filePath !== undefined && { filePath }),
    readEditorConfig: async (): Promise<EditorConfigSource> => {
      if (filePath === undefined) {
        return { preferred: remembered, editors: undefined };
      }
      const stored = await readSettingsFile(filePath);
      const preferred = stored['preferredEditor'];
      if (typeof preferred === 'string' && isEditorId(preferred)) {
        return { preferred, editors: stored['editors'] };
      }
      return { preferred: undefined, editors: stored['editors'] };
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
