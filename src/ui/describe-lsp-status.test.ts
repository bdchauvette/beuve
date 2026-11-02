import { describe } from 'vitest';

import type { LspServerView } from '#contract/ipc-contract.ts';

import { test } from './testing/test.ts';

import { describeLspStatus } from './describe-lsp-status.ts';

describe('describeLspStatus', () => {
  test('says none are running before the first request', ({ expect }) => {
    expect(describeLspStatus([])).toMatchObject({
      tone: 'muted',
      text: 'Language servers: none running',
    });
  });

  test('counts running and starting servers, and leans on starting', ({ expect }) => {
    expect(
      describeLspStatus([
        server('typescript', 'running'),
        server('typescript', 'running'),
        server('go', 'starting'),
      ]),
    ).toMatchObject({ tone: 'starting', text: 'Language servers: 2 running · 1 starting' });
  });

  test('does not count a server that is stopping', ({ expect }) => {
    expect(describeLspStatus([server('typescript', 'stopping')])).toMatchObject({
      tone: 'muted',
      text: 'Language servers: none running',
    });
  });
});

function server(serverId: string, state: LspServerView['state']): LspServerView {
  return { serverId, root: `/checkouts/${serverId}`, state, openDocuments: 0, restarts: 0 };
}
