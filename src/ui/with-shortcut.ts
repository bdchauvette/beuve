/** A tooltip's text and the shortcut that runs the same command, `''` without one. */
export interface LabeledShortcut {
  readonly label: string;
  readonly shortcut: string;
}

/** `Next (⌘G)`: a tooltip with its command's shortcut (ADR 0068), or the label alone. Pure. */
export function withShortcut({ label, shortcut }: LabeledShortcut): string {
  if (shortcut === '') {
    return label;
  }
  return `${label} (${shortcut})`;
}
