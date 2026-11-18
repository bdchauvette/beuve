import { countNoun } from './count-noun.ts';

/**
 * The notice after deleting notes (ADR 0142): one note by its title, several by their count.
 * `titles` are already revealed for display. Pure.
 */
export function describeNoteDeletion(titles: readonly string[]): string {
  const [only] = titles;
  if (only !== undefined && titles.length === 1) {
    return `Deleted “${only}”.`;
  }
  return `Deleted ${countNoun(titles.length, 'note')}.`;
}
