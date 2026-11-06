import { describe } from 'vitest';

import { listViewerTeams } from './list-viewer-teams.ts';
import { test } from './testing/test.ts';

describe('listViewerTeams', () => {
  test('lists the teams with their organizations', async ({ expect, fakeGithub, signal }) => {
    const { client, requests } = fakeGithub(() => {
      return {
        status: 200,
        body: [{ id: 1, slug: 'core', name: 'Core', organization: { login: 'octo-org' } }],
      };
    });
    await expect(listViewerTeams(client, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [{ organization: 'octo-org', slug: 'core' }],
    });
    expect(requests[0]?.url).toBe('https://api.github.com/user/teams?per_page=100');
  });

  test('fails as GitHub does without read:org', async ({ expect, fakeGithub, signal }) => {
    const { client } = fakeGithub(() => {
      return { status: 403, body: { message: 'Resource not accessible by integration' } };
    });
    await expect(listViewerTeams(client, { signal })).resolves.toMatchObject({ ok: false });
  });
});
