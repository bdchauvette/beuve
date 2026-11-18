import type { EditorChoiceView, EditorSettingsView } from '#contract/ipc-contract.ts';

/**
 * The lines the notice after choosing an editor prints (ADR 0139): the choice, or what happens
 * without one, every editor by its id, and what is wrong with `editors` in `settings.json`.
 */
export function describeEditorSettings(settings: EditorSettingsView): readonly string[] {
  const preferred = settings.editors.find((editor) => editor.id === settings.preferred);
  const current = settings.editors.find((editor) => editor.id === settings.current);
  const lines: string[] = [];
  if (settings.preferred === undefined) {
    if (current === undefined) {
      lines.push('No editor chosen. Choose one in Review › Open With.');
    } else {
      lines.push(`No editor chosen: Open in Editor uses ${current.name}, the only one found.`);
    }
  } else if (preferred === undefined) {
    lines.push(
      `Preferred editor: “${settings.preferred}”, which settings.json no longer defines. Choose another in Review › Open With.`,
    );
  } else if (preferred.installed) {
    lines.push(`Preferred editor: ${preferred.name}.`);
  } else {
    lines.push(`Preferred editor: ${preferred.name} (not found on this machine).`);
  }
  if (settings.editors.length === 0) {
    lines.push('No editors are configured.');
  } else {
    lines.push(`Editors: ${settings.editors.map((editor) => entryOf(editor)).join(', ')}.`);
  }
  for (const problem of settings.problems) {
    lines.push(`settings.json: ${problem}.`);
  }
  return lines;
}

function entryOf(editor: EditorChoiceView): string {
  if (editor.installed) {
    return `${editor.id} (${editor.name})`;
  }
  return `${editor.id} (${editor.name}, not found)`;
}
