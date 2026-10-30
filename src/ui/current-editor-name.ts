import type { EditorSettingsView } from '#contract/ipc-contract.ts';

/** The editor Open in Editor will use: the preferred one, else the first installed; `''` when unknown. */
export function currentEditorName(settings: EditorSettingsView | undefined): string {
  const choices = settings?.editors ?? [];
  const chosen = choices.find((editor) => editor.id === settings?.preferred && editor.installed);
  return (chosen ?? choices.find((editor) => editor.installed))?.name ?? '';
}
