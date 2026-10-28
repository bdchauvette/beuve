import type { EditorId } from '#contract/ipc-contract.ts';

import { editorDefinitions } from '../editor-definitions.ts';
import type { EditorDefinition } from '../editor-definitions.ts';

/** The registry entry for `id`; throws if the registry lacks it. */
export function getEditorDefinition(id: EditorId): EditorDefinition {
  const found = editorDefinitions.find((definition) => definition.id === id);
  if (found === undefined) {
    throw new Error(`no editor definition for ${id}`);
  }
  return found;
}
