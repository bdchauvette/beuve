/** The four zones of spec section 4, plus the status bar that reports on them. */
export type ZoneId = 'intent' | 'diff' | 'ura' | 'chat';

export interface Zone {
  readonly id: ZoneId;
  readonly label: string;
}

/** Zones in Tab order. */
export const zones: readonly Zone[] = Object.freeze([
  { id: 'intent', label: 'Intent' },
  { id: 'diff', label: 'Diff stream' },
  { id: 'ura', label: 'Review dock' },
  { id: 'chat', label: 'Chat' },
]);
