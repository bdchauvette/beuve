import { describe } from 'vitest';

import { describeOpenedConfig } from './describe-opened-config.ts';
import { test } from './testing/test.ts';

describe('describeOpenedConfig', () => {
  test('names the file, and says when it was just made', ({ expect }) => {
    expect(
      describeOpenedConfig({
        path: '/home/me/.config/beuve/language-servers.json',
        created: false,
      }),
    ).toBe(
      'Opened /home/me/.config/beuve/language-servers.json. Restart Language Servers (Review menu) after saving.',
    );
    expect(
      describeOpenedConfig({ path: '/home/me/.config/beuve/language-servers.json', created: true }),
    ).toContain('Created an empty /home/me/.config/beuve/language-servers.json and opened it.');
  });

  test('shows invisible and bidirectional characters in the path', ({ expect }) => {
    expect(describeOpenedConfig({ path: '/home/me/\u{202E}config', created: false })).toContain(
      '⟨U+202E⟩',
    );
  });
});
