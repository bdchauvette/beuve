const escape = /⟨U\+([\dA-F]{4,6})⟩/gu;

/**
 * The text `revealFormatControls` was given: each `⟨U+XXXX⟩` escape becomes its character again.
 * For views that take display names and hand them back, such as the file tree (ADR 0082).
 */
export function restoreFormatControls(revealed: string): string {
  return revealed.replaceAll(escape, (_match, hex: string) => {
    return String.fromCodePoint(Number.parseInt(hex, 16));
  });
}
