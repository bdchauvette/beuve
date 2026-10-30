import { describe } from 'vitest';

import { parseRemoteUrls } from './parse-remote-urls.ts';
import { test } from './testing/test.ts';

describe('parseRemoteUrls', () => {
  test('splits NUL-terminated key/value entries and skips anything else', ({ expect }) => {
    const output = [
      'remote.origin.url\nhttps://github.com/o/r.git',
      'remote.a.b.url\n/tmp/bare.git',
      'remote.empty.url\n',
      'garbage',
      '',
    ].join('\0');
    expect(parseRemoteUrls(output)).toStrictEqual([
      { name: 'origin', url: 'https://github.com/o/r.git' },
      { name: 'a.b', url: '/tmp/bare.git' },
    ]);
  });
});
