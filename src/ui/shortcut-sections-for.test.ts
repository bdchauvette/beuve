import { describe } from 'vitest';

import { commandCatalog } from '#contract/command-catalog.ts';

import { test } from './testing/test.ts';

import { shortcutSectionsFor } from './shortcut-sections-for.ts';

describe('shortcutSectionsFor', () => {
  test('groups keyed commands by menu, then in-place keys by area', ({ expect }) => {
    const sections = shortcutSectionsFor(commandCatalog, 'mac');
    expect(sections.map((section) => section.title)).toStrictEqual([
      'beuve',
      'File',
      'Edit',
      'View',
      'Go',
      'Review',
      'Chat',
      'Review notes',
      'Chat',
      'Portals',
      'Sheets',
      'Files and lists',
    ]);
    expect(sections.find((section) => section.title === 'Go')?.rows[2]).toStrictEqual({
      title: 'Next Change',
      keys: ['⌘↓', 'F7'],
    });
  });

  test('uses the Linux keys and menus on Linux', ({ expect }) => {
    const sections = shortcutSectionsFor(commandCatalog, 'linux');
    expect(sections.map((section) => section.title)).not.toContain('beuve');
    expect(sections.find((section) => section.title === 'Edit')?.rows).toContainEqual({
      title: 'Settings…',
      keys: ['Ctrl+,'],
    });
    expect(sections.find((section) => section.title === 'Help')?.rows).toStrictEqual([
      { title: 'Keyboard Shortcuts', keys: ['Ctrl+?'] },
    ]);
  });
});
