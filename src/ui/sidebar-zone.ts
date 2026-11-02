import type { ZoneId } from './zones.ts';

/** The zones that live in the sidebar's tabs: every zone but the diff. */
export type SidebarZone = Exclude<ZoneId, 'diff'>;
