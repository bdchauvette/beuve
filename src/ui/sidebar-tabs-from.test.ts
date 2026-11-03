import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { sidebarTabsFrom } from './sidebar-tabs-from.ts';

describe('sidebarTabsFrom', () => {
  test('a pull request has an Overview before Files, Review and Chat', ({ expect }) => {
    const tabs = sidebarTabsFrom({ isPullRequest: true, stagedCount: 0 });
    expect(tabs.map((tab) => tab.label)).toStrictEqual(['Overview', 'Files', 'Review', 'Chat']);
    expect(tabs.map((tab) => tab.zone)).toStrictEqual(['overview', 'files', 'ura', 'chat']);
  });

  test('a local review has no Overview', ({ expect }) => {
    const tabs = sidebarTabsFrom({ isPullRequest: false, stagedCount: 0 });
    expect(tabs.map((tab) => tab.zone)).toStrictEqual(['files', 'ura', 'chat']);
  });

  test('the staged count sits on the Review tab only', ({ expect }) => {
    const tabs = sidebarTabsFrom({ isPullRequest: true, stagedCount: 3 });
    expect(tabs.map((tab) => tab.count)).toStrictEqual([0, 0, 3, 0]);
  });
});
