import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { answerServerRequest } from './answer-server-request.ts';
import type { ServerRequestContext } from './answer-server-request.ts';

function context(): ServerRequestContext {
  return {
    settings: { typescript: { format: { semicolons: 'insert' } } },
    workspaceFolders: [{ uri: 'file:///w', name: 'w' }],
  };
}

describe('answerServerRequest', () => {
  test('refuses workspace edits', ({ expect }) => {
    expect(answerServerRequest('workspace/applyEdit', { edit: {} }, context())).toStrictEqual({
      ok: true,
      value: { applied: false, failureReason: 'beuve is a read-only review tool' },
    });
  });

  test('answers configuration by dotted section, in order', ({ expect }) => {
    const params = {
      items: [
        { section: 'typescript.format' },
        { section: 'nope.deeper' },
        {},
        { section: 'typescript.format.semicolons' },
      ],
    };
    expect(answerServerRequest('workspace/configuration', params, context())).toStrictEqual({
      ok: true,
      value: [{ semicolons: 'insert' }, undefined, context().settings, 'insert'],
    });
    expect(answerServerRequest('workspace/configuration', 'junk', context())).toStrictEqual({
      ok: true,
      value: [],
    });
  });

  test.for([
    'window/workDoneProgress/create',
    'client/registerCapability',
    'workspace/diagnostic/refresh',
  ])('acknowledges %s', (method, { expect }) => {
    expect(answerServerRequest(method, {}, context())).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  test('declines UI requests and lists the workspace folders', ({ expect }) => {
    expect(answerServerRequest('window/showDocument', {}, context())).toStrictEqual({
      ok: true,
      value: { success: false },
    });
    expect(answerServerRequest('workspace/workspaceFolders', undefined, context())).toStrictEqual({
      ok: true,
      value: context().workspaceFolders,
    });
  });

  test('reports unknown methods as not found', ({ expect }) => {
    expect(answerServerRequest('workspace/willRenameFiles', {}, context())).toMatchObject({
      ok: false,
      error: { code: -32_601 },
    });
  });
});
