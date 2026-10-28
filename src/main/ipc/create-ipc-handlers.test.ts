import { describe, expect, it } from 'vitest';

import { ok } from '#pkg/result/ok.ts';

import type { AppInfo, SessionSummary } from '../../contract/ipc-contract.ts';
import { createUnwiredServices } from '../create-unwired-services.ts';

import { createIpcHandlers } from './create-ipc-handlers.ts';

const appInfo: AppInfo = {
  name: 'beuve',
  version: '0.1.0',
  platform: 'linux',
  electronVersion: '45.1.0',
  chromeVersion: '140',
  nodeVersion: '24',
};

const session: SessionSummary = {
  id: 's1',
  source: { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'feature' },
  headSha: 'a'.repeat(40),
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
};

const opening = Promise.resolve(ok(session));

describe('createIpcHandlers', () => {
  it('answers app:get-info and rejects unexpected arguments', async () => {
    const handlers = createIpcHandlers(createUnwiredServices(), appInfo);
    expect(await handlers['app:get-info'](undefined)).toEqual(ok(appInfo));
    expect(await handlers['app:get-info']({ sneaky: true })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  it('reports unwired session services honestly', async () => {
    const handlers = createIpcHandlers(createUnwiredServices(), appInfo);
    expect(await handlers['session:list'](undefined)).toMatchObject({
      ok: false,
      error: { code: 'not-wired' },
    });
  });

  it('validates session:open before delegating', async () => {
    const opened: unknown[] = [];
    const services = createUnwiredServices();
    const handlers = createIpcHandlers(
      {
        ...services,
        sessions: {
          ...services.sessions,
          open: async (request) => {
            opened.push(request);
            return opening;
          },
        },
      },
      appInfo,
    );
    for (const bad of [undefined, 'id', { sessionId: '' }, { sessionId: 's1', extra: 1 }]) {
      expect(await handlers['session:open'](bad)).toMatchObject({
        ok: false,
        error: { code: 'invalid-request' },
      });
    }
    expect(await handlers['session:open']({ sessionId: 's1' })).toEqual(ok(session));
    expect(opened).toEqual([{ sessionId: 's1' }]);
  });
});
