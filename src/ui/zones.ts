/** The four zones of spec section 4, plus the status bar that reports on them. */
export type ZoneId = 'intent' | 'diff' | 'ura' | 'chat';

export interface Zone {
  readonly id: ZoneId;
  /** The status bar's name for the focused region. */
  readonly label: string;
  /** The few keys worth showing while the region has focus. */
  readonly hints: string;
}

/** Zones in Tab order. */
export const zones: readonly Zone[] = Object.freeze([
  { id: 'intent', label: 'Intent & files', hints: '↑↓ move · ⏎ show file · f changed only' },
  { id: 'diff', label: 'Diff', hints: 'j k hunks · m stage · p peek · ] insight' },
  { id: 'ura', label: 'Review', hints: 'j k move · ⏎ show · Space edit · x withdraw' },
  { id: 'chat', label: 'Chat', hints: '⏎ ask · ↑ answers · Esc back' },
]);
