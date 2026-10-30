import { describe, expectTypeOf } from 'vitest';

import { test } from '#testing/test.ts';

import type { InvokeChannel, SheetInvokeChannel } from './ipc-contract.ts';
import { isSheetInvokeChannel } from './is-sheet-invoke-channel.ts';
import { sheetInvokeChannels } from './sheet-invoke-channels.ts';

describe('isSheetInvokeChannel', () => {
  test('lists every sheet channel once, each a contract channel', ({ expect }) => {
    expectTypeOf<
      Exclude<SheetInvokeChannel, (typeof sheetInvokeChannels)[number]>
    >().toEqualTypeOf<never>();
    expectTypeOf<SheetInvokeChannel>().toExtend<InvokeChannel>();
    expect(new Set(sheetInvokeChannels).size).toBe(sheetInvokeChannels.length);
  });

  test('refuses every other channel', ({ expect }) => {
    expect(isSheetInvokeChannel('sheet:get-file')).toBe(true);
    expect(isSheetInvokeChannel('ura:create')).toBe(false);
    expect(isSheetInvokeChannel('editor:open')).toBe(false);
    expect(isSheetInvokeChannel(undefined)).toBe(false);
  });
});
