import { describe, expect, it } from 'vitest';

import { parseRemoteUrls } from './parse-remote-urls.ts';

describe('parseRemoteUrls', () => {
  it('splits NUL-terminated key/value entries and skips anything else', () => {
    const output = [
      'remote.origin.url\nhttps://github.com/o/r.git',
      'remote.a.b.url\n/tmp/bare.git',
      'remote.empty.url\n',
      'garbage',
      '',
    ].join('\0');
    expect(parseRemoteUrls(output)).toEqual([
      { name: 'origin', url: 'https://github.com/o/r.git' },
      { name: 'a.b', url: '/tmp/bare.git' },
    ]);
  });
});
