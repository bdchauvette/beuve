import { zones } from './zones.ts';
import type { ZoneId } from './zones.ts';

/** What decides which zones Next Region visits. */
export interface ZoneOrderInput {
  /** A review is open and its sidebar is showing. */
  readonly hasSidebar: boolean;
  /** The Overview zone exists only for a pull request (ADR 0109). */
  readonly isPullRequest: boolean;
}

/** The zones Next Region visits, in order: the diff always, the sidebar's zones while it shows. Pure. */
export function zoneOrderFrom(input: ZoneOrderInput): ZoneId[] {
  return zones
    .map(({ id }) => id)
    .filter((id) => {
      if (id === 'diff') {
        return true;
      }
      if (id === 'overview') {
        return input.hasSidebar && input.isPullRequest;
      }
      return input.hasSidebar;
    });
}
