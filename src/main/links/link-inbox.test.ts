import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { LinkInbox } from './link-inbox.ts';

describe('LinkInbox', () => {
  test('keeps links until a handler attaches, then passes them on in order', ({ expect }) => {
    const inbox = new LinkInbox();
    const seen: string[] = [];
    inbox.push('beuve://open?url=a');
    inbox.push('beuve://open?url=b');
    inbox.attach((link) => {
      seen.push(link);
    });
    inbox.push('BEUVE://open?url=c');
    expect(seen).toStrictEqual(['beuve://open?url=a', 'beuve://open?url=b', 'BEUVE://open?url=c']);
  });

  test('ignores arguments that are not beuve:// links', ({ expect }) => {
    const inbox = new LinkInbox();
    const seen: string[] = [];
    inbox.attach((link) => {
      seen.push(link);
    });
    for (const argument of ['/usr/bin/beuve', '--flag', 'https://example.com', 'beuve:/x']) {
      inbox.push(argument);
    }
    expect(seen).toStrictEqual([]);
  });
});
