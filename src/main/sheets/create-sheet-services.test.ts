import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';

describe('createSheetServices', () => {
  test('checkLines takes only text lines of a file at the sheet’s commit', async ({
    expect,
    repo,
    services,
  }) => {
    repo.write('src/a.ts', 'one\ntwo\nthree\n');
    await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('src/a.ts', 'one\ntwo\nthree\nfour\n');
    repo.write('image.bin', Uint8Array.of(0, 1, 2, 0, 255));
    const sha = await repo.commit('feature');
    const { id: sessionId } = okValueFrom(
      await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    );
    const lines = { sessionId, sha, path: 'src/a.ts', startLine: 2, endLine: 4 };

    await expect(services.sheets.checkLines(lines)).resolves.toStrictEqual({
      ok: true,
      value: { opened: true },
    });
    await expect(services.sheets.checkLines({ ...lines, endLine: 5 })).resolves.toStrictEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'src/a.ts has 4 lines at that commit' },
    });
    await expect(
      services.sheets.checkLines({ ...lines, path: 'src/gone.ts' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
    await expect(
      services.sheets.checkLines({ ...lines, path: 'image.bin', startLine: 1, endLine: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });
});
