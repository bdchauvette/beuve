import { describe } from 'vitest';

import type { ReviewView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { lines } from '../testing/lines.ts';
import { test } from '../testing/test.ts';

describe('review:get shebang lines (integration: SQLite + git)', { timeout: 30_000 }, () => {
  test('sends the #! line of extensionless files only, from either side', async ({
    expect,
    services: { sessions },
    repo,
    signal,
  }) => {
    repo.write('bin/old', lines(['#!/bin/sh', 'echo old']));
    repo.write('bin/long', lines(['#!/usr/bin/env -S python3 -u', ...numbered(40)]));
    repo.write('base.txt', lines(['base']));
    await repo.commit('base');
    await repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('bin/deploy', lines(['#!/usr/bin/env bash', 'echo deploy']));
    repo.write('tool.sh', lines(['#!/usr/bin/env zsh', 'print -P "%F{blue}tool%f"', 'exit 0']));
    repo.write('NOTES', lines(['no shebang here']));
    repo.write('bin/long', lines(['#!/usr/bin/env -S python3 -u', ...numbered(39), 'changed']));
    await repo.git('rm', '--quiet', 'bin/old');
    await repo.commit('scripts');
    await repo.git('switch', '--quiet', 'main');
    const created = okValueFrom(
      await sessions.createLocal({ repoPath: repo.directory, baseRef: 'main', headRef: 'feature' }),
    );
    const review = okValueFrom(await sessions.getReview({ sessionId: created.id }, { signal }));
    expect(shebangsOf(review)).toStrictEqual([
      ['NOTES', undefined],
      ['bin/deploy', '#!/usr/bin/env bash'],
      ['bin/long', '#!/usr/bin/env -S python3 -u'],
      ['bin/old', '#!/bin/sh'],
      ['tool.sh', undefined],
    ]);
    expect(review.files.find((file) => file.path === 'bin/long')?.patch).not.toContain('#!');
  });
});

function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `print(${String(index)})`);
}

function shebangsOf(review: ReviewView): [string, string | undefined][] {
  return review.files.map((file) => {
    return [file.path, file.shebang];
  });
}
