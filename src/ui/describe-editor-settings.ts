import type { EditorSettingsView } from '#contract/ipc-contract.ts';

/** The lines `/editor` prints. */
export function describeEditorSettings(settings: EditorSettingsView): readonly string[] {
  const preferred = settings.editors.find((editor) => editor.id === settings.preferred);
  const installed = settings.editors.filter((editor) => editor.installed);
  const names = installed.map((editor) => editor.name).join(', ');
  const lines: string[] = [];
  if (preferred === undefined) {
    lines.push(
      'No editor chosen: o uses the first one found. Choose with /editor zed|vscode|cursor.',
    );
  } else if (preferred.installed) {
    lines.push(`Preferred editor: ${preferred.name}.`);
  } else {
    lines.push(`Preferred editor: ${preferred.name} (not found on this machine).`);
  }
  if (installed.length === 0) {
    lines.push('No supported editor found.');
  } else {
    lines.push(`Found: ${names}.`);
  }
  return lines;
}
