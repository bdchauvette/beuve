/** The four zones of spec section 4, plus the status bar that reports on them. */
export type ZoneId = 'intent' | 'diff' | 'ura' | 'chat';

export interface Zone {
  readonly id: ZoneId;
  /** The status bar's name for the focused region. */
  readonly label: string;
}

/** Zones in Next Region order (ADR 0068). */
export const zones: readonly Zone[] = Object.freeze([
  { id: 'intent', label: 'Intent & files' },
  { id: 'diff', label: 'Diff' },
  { id: 'ura', label: 'Review' },
  { id: 'chat', label: 'Chat' },
]);
