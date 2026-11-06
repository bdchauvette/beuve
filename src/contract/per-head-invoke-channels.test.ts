import { describe, expectTypeOf } from 'vitest';

import { test } from '#testing/test.ts';

import { invokeChannels } from './invoke-channels.ts';
import type { InvokeChannel, InvokeRequest } from './ipc-contract.ts';
import { perHeadInvokeChannels } from './per-head-invoke-channels.ts';
import type { PerHeadInvokeChannel } from './per-head-invoke-channels.ts';

/** `true` when any member of a request union can name a session. */
type NamesSession<R> = R extends object ? ('sessionId' extends keyof R ? true : never) : never;

/** Every channel whose request names a session, so may touch state that belongs to its head. */
type SessionInvokeChannel = {
  [C in InvokeChannel]: [NamesSession<InvokeRequest<C>>] extends [never] ? never : C;
}[InvokeChannel];

describe('perHeadInvokeChannels (ADR 0078)', () => {
  test('every per-head request carries a required expectedHeadSha', ({ expect }) => {
    /** The per-head channels whose request lacks a required `expectedHeadSha`: there must be none. */
    type MissingHeadSha = {
      [C in PerHeadInvokeChannel]: InvokeRequest<C> extends { readonly expectedHeadSha: string }
        ? never
        : C;
    }[PerHeadInvokeChannel];
    expectTypeOf<MissingHeadSha>().toEqualTypeOf<never>();
    expectTypeOf<PerHeadInvokeChannel>().toExtend<SessionInvokeChannel>();
    expect(
      perHeadInvokeChannels.filter((channel) => !invokeChannels.includes(channel)),
    ).toStrictEqual([]);
    expect(new Set(perHeadInvokeChannels).size).toBe(perHeadInvokeChannels.length);
  });

  test('every other channel that takes a session says why it needs no head', ({ expect }) => {
    const exempt = Object.entries(headFreeSessionChannels());
    const perHead: readonly string[] = perHeadInvokeChannels;
    expect(exempt.filter(([channel]) => perHead.includes(channel))).toStrictEqual([]);
    expect(exempt.filter(([, reason]) => reason.trim() === '')).toStrictEqual([]);
  });
});

/**
 * Every session channel that is not per-head, with the reason. The type makes it exhaustive: a new
 * channel that takes a `sessionId` doesn't compile until it is listed here or in
 * `perHeadInvokeChannels`.
 */
function headFreeSessionChannels(): Readonly<
  Record<Exclude<SessionInvokeChannel, PerHeadInvokeChannel>, string>
> {
  const read = 'a read: its answer names the head it describes';
  return {
    'session:get-review': read,
    'session:get-order': read,
    'session:get-file-pair': read,
    'session:get-tree': read,
    'session:get-file-attributes': read,
    'lsp:definition': 'a read pinned to its own `sha`',
    'lsp:hover': 'a read pinned to its own `sha`',
    'lsp:restart': 'restarts servers; it stores nothing about a head',
    'sheet:open': 'opens a window pinned to its own `sha`',
    'sheet:get-file': 'a read pinned to its own `sha`',
    'sheet:get-head': read,
    'remote:permalink': 'a link pinned to its own `sha`',
    'remote:open-permalink': 'a link pinned to its own `sha`',
    'remote:open-commit': 'a link pinned to its own `sha`',
    'flow:get-graph': read,
    'terminal:list': 'a read: each terminal names the head whose checkout it runs in',
    'ura:list': read,
    'ura:create': 'the item records the head its anchor refers to and is re-anchored on every read',
    'ura:reorder': 'dock order belongs to the session, not a head',
    'ura:export':
      'copies to the clipboard for the reviewer to paste; the export names the head it was compiled at',
    'chat:ask': 'the answer records the head it was asked at (ADR 0057)',
    'chat:list': read,
    'chat:cancel': 'stops work; it stores nothing about a head',
    'chat:compact': 'a summary of the conversation, which spans heads',
    'chat:clear': 'the transcript belongs to the session, not a head',
    'editor:open': 'opens a file for the reviewer; it stores nothing',
    'review-edits:get': read,
    'review-edits:open':
      'the branch records the head it starts from (ADR 0088); a later head leaves it there',
    'review-edits:preview-suggestions': 'a read: the plan names the head its items anchor to',
    'review-edits:stage-suggestions':
      'items anchor to the edits branch’s recorded base, which the previewed digest pins',
    'review-edits:preview-discard': read,
    'review-edits:discard': 'removes the edits branch, which belongs to the session, not a head',
    'github:get-pr': read,
    'github:get-branch': 'a read of stored branch metadata; its answer names the head',
    'github:get-timeline': read,
  };
}
