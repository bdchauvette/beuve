import type { DiagnosticItemView } from '#contract/ipc-contract.ts';

/** A place in the head's file: 1-based line, 0-based UTF-16 character. */
export interface DiagnosticPosition {
  readonly line: number;
  readonly character: number;
}

/**
 * The diagnostics whose range covers `position`, in the order given. A range ends before its end
 * character, as in the protocol, and an empty range covers the character it sits on, so a "missing
 * semicolon" reported at one point can still be hovered.
 */
export function diagnosticsAt(
  items: readonly DiagnosticItemView[],
  position: DiagnosticPosition,
): DiagnosticItemView[] {
  return items.filter((item) => {
    const isAfterStart =
      position.line > item.startLine ||
      (position.line === item.startLine && position.character >= item.startCharacter);
    if (!isAfterStart) {
      return false;
    }
    if (item.endLine === item.startLine && item.endCharacter === item.startCharacter) {
      return position.line === item.startLine && position.character === item.startCharacter;
    }
    return (
      position.line < item.endLine ||
      (position.line === item.endLine && position.character < item.endCharacter)
    );
  });
}
