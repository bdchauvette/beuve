import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

const lineBreak = /\r?\n/u;

/**
 * An install log as the renderer shows it (ADR 0082): every hidden or reordering character is
 * revealed, but line breaks stay line breaks and a tab becomes two spaces, so the log still
 * reads as lines.
 */
export function revealLogText(text: string): string {
  return text
    .split(lineBreak)
    .map((line) => revealFormatControls(line.replaceAll('\t', '  ')))
    .join('\n');
}
