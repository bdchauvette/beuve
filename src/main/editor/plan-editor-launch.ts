import { buildEditorArgv } from './build-editor-argv.ts';
import { buildEditorUrl } from './build-editor-url.ts';
import type { EditorDefinition } from './editor-definitions.ts';
import type { EditorLocation } from './editor-location.ts';
import type { FoundEditor } from './find-editor.ts';

export type LaunchPlan =
  | { readonly kind: 'spawn'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'url'; readonly url: string };

/** The CLI when one was found (no shell, argv from the editor's template), otherwise its URL. */
export function planEditorLaunch(
  definition: EditorDefinition,
  found: FoundEditor,
  target: EditorLocation,
): LaunchPlan {
  if (found.kind === 'cli') {
    return {
      kind: 'spawn',
      command: found.command,
      args: buildEditorArgv(definition.args, target),
    };
  }
  return { kind: 'url', url: buildEditorUrl(found.scheme, target) };
}
