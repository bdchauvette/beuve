import type { EditorDefinition } from './editor-definitions.ts';
import { buildEditorUrl } from './build-editor-url.ts';
import type { FoundEditor } from './find-editor.ts';

export type LaunchPlan =
  | { readonly kind: 'spawn'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'url'; readonly url: string };

/** The CLI when one was found (no shell, argv only), otherwise the editor's URL scheme. */
export function planEditorLaunch(
  definition: EditorDefinition,
  found: FoundEditor,
  target: { readonly file: string; readonly line: number; readonly column: number },
): LaunchPlan {
  const { file, line, column } = target;
  if (found.kind === 'cli') {
    return {
      kind: 'spawn',
      command: found.command,
      args: definition.buildArgv(file, line, column),
    };
  }
  return { kind: 'url', url: buildEditorUrl(definition.urlScheme, file, line, column) };
}
