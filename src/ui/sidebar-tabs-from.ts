import type { SidebarZone } from './sidebar-zone.ts';

/** One tab of the sidebar: its zone, label, and a count shown beside it when not zero. */
export interface SidebarTab {
  readonly zone: SidebarZone;
  readonly label: string;
  readonly count: number;
}

/** What decides the tabs. */
export interface SidebarTabsInput {
  /** Only a pull request has an Overview (ADR 0109). */
  readonly isPullRequest: boolean;
  /** How many items the review has staged, shown beside the Review tab. */
  readonly stagedCount: number;
}

/** The sidebar's tabs, left to right: Overview (pull requests only), Files, Review, Chat. Pure. */
export function sidebarTabsFrom(input: SidebarTabsInput): readonly SidebarTab[] {
  const tabs: SidebarTab[] = [];
  if (input.isPullRequest) {
    tabs.push({ zone: 'overview', label: 'Overview', count: 0 });
  }
  tabs.push(
    { zone: 'files', label: 'Files', count: 0 },
    { zone: 'ura', label: 'Review', count: input.stagedCount },
    { zone: 'chat', label: 'Chat', count: 0 },
  );
  return tabs;
}
