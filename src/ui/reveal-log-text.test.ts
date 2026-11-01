import { describe } from 'vitest';

import { revealLogText } from './reveal-log-text.ts';
import { test } from './testing/test.ts';

describe('revealLogText (ADR 0082)', () => {
  test('keeps lines, turns tabs into spaces and reveals everything else', ({ expect }) => {
    expect(revealLogText('added 1 package\r\n\tnext\nevil\u{202E}txt.sh\u{1B}[31m')).toBe(
      'added 1 package\n  next\nevil⟨U+202E⟩txt.sh⟨U+001B⟩[31m',
    );
  });
});
