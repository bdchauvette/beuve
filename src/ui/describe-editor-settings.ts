import type { EditorSettingsView } from '#contract/ipc-contract.ts';

/** The lines `/editor` prints. */
export function describeEditorSettings(settings: EditorSettingsView): readonly string[] {
  const preferred = settings.editors.find((editor) => editor.id === settings.preferred);
  const installed = settings.editors.filter((editor) => editor.installed);
  const names = installed.map((editor) => editor.name).join(', ');
  return [
    preferred === undefined
      ? 'No editor chosen: o uses the first one found. Choose with /editor zed|vscode|cursor.'
      : `Preferred editor: ${preferred.name}${preferred.installed ? '' : ' (not found on this machine)'}.`,
    installed.length === 0 ? 'No supported editor found.' : `Found: ${names}.`,
  ];
}
