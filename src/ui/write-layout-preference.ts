import type { LayoutPreference } from './read-layout-preference.ts';

/** Stores the layout choice in this window's storage; ignores storage that refuses. */
export function writeLayoutPreference(preference: LayoutPreference): void {
  try {
    localStorage.setItem('beuve.layout', JSON.stringify(preference));
  } catch {
    // Private windows and blocked storage just don't remember.
  }
}
