import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { createShellServices } from './create-shell-services.ts';

/** Shell services whose `openExternal` records what it was asked to open. */
function recordingShell(): {
  readonly opened: string[];
  readonly shell: ReturnType<typeof createShellServices>;
} {
  const opened: string[] = [];
  const shell = createShellServices({
    openExternal: async (url): Promise<void> => {
      opened.push(url);
      await Promise.resolve();
    },
  });
  return { opened, shell };
}

describe('createShellServices', () => {
  test.for([
    ['https://example.com/docs', 'https://example.com/docs'],
    // eslint-disable-next-line unicorn/prefer-https -- plain http links open too, on purpose.
    ['http://example.com/a b', 'http://example.com/a%20b'],
    ['HTTPS://Example.COM:8443/x?q=1#h', 'https://example.com:8443/x?q=1#h'],
    ['https://github.com/bdchauvette/beuve', 'https://github.com/bdchauvette/beuve'],
  ] as const)(
    'opens %s in the browser, as the URL parser normalises it',
    async ([url, href], { expect }) => {
      const { opened, shell } = recordingShell();
      await expect(shell.openUrl({ url })).resolves.toStrictEqual({
        ok: true,
        value: { opened: true },
      });
      expect(opened).toStrictEqual([href]);
    },
  );

  test.for([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'vscode://file/etc/passwd',
    'zed://file/x',
    'mailto:a@example.com',
    'ftp://example.com/x',
    '//example.com/x',
    '/relative/path',
    'example.com',
    'not a url',
  ])('refuses %s as invalid, without opening anything', async (url, { expect }) => {
    const { opened, shell } = recordingShell();
    await expect(shell.openUrl({ url })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(opened).toStrictEqual([]);
  });

  test('answers not-wired outside Electron', async ({ expect }) => {
    await expect(
      createShellServices({}).openUrl({ url: 'https://example.com' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-wired' } });
  });
});
