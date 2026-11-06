import type { OpenedConfigView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/**
 * What the Settings row says once `language-servers.json` is open: which file, and that it was
 * just made when it was. The path is shown with invisible and bidirectional controls made visible
 * (ADR 0082).
 */
export function describeOpenedConfig(opened: OpenedConfigView): string {
  const file = revealFormatControls(opened.path);
  if (opened.created) {
    return `Created an empty ${file} and opened it. Restart Language Servers (Review menu) after saving.`;
  }
  return `Opened ${file}. Restart Language Servers (Review menu) after saving.`;
}
