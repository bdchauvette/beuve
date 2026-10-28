import { describe, expect, it } from 'vitest';

import { answerServerRequest } from './answer-server-request.ts';

const context = {
  settings: { typescript: { format: { semicolons: 'insert' } } },
  workspaceFolders: [{ uri: 'file:///w', name: 'w' }],
};

describe('answerServerRequest', () => {
  it('refuses workspace edits', () => {
    expect(answerServerRequest('workspace/applyEdit', { edit: {} }, context)).toEqual({
      ok: true,
      value: { applied: false, failureReason: 'beuve is a read-only review tool' },
    });
  });

  it('answers configuration by dotted section, in order', () => {
    const params = {
      items: [
        { section: 'typescript.format' },
        { section: 'nope.deeper' },
        {},
        { section: 'typescript.format.semicolons' },
      ],
    };
    expect(answerServerRequest('workspace/configuration', params, context)).toEqual({
      ok: true,
      value: [{ semicolons: 'insert' }, undefined, context.settings, 'insert'],
    });
    expect(answerServerRequest('workspace/configuration', 'junk', context)).toEqual({
      ok: true,
      value: [],
    });
  });

  it('acknowledges progress, registrations and refreshes, and declines UI requests', () => {
    for (const method of [
      'window/workDoneProgress/create',
      'client/registerCapability',
      'workspace/diagnostic/refresh',
    ]) {
      expect(answerServerRequest(method, {}, context), method).toEqual({
        ok: true,
        value: undefined,
      });
    }
    expect(answerServerRequest('window/showDocument', {}, context)).toEqual({
      ok: true,
      value: { success: false },
    });
    expect(answerServerRequest('workspace/workspaceFolders', undefined, context)).toEqual({
      ok: true,
      value: context.workspaceFolders,
    });
  });

  it('reports unknown methods as not found', () => {
    expect(answerServerRequest('workspace/willRenameFiles', {}, context)).toMatchObject({
      ok: false,
      error: { code: -32_601 },
    });
  });
});
