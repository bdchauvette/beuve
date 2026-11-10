import { test } from '#testing/test.ts';

import { SetupMarkerWatcher } from './setup-marker-watcher.ts';

test('sees a marker split across chunks, once', ({ expect }) => {
  const watcher = new SetupMarkerWatcher('\u{1B}]7703;beuve-setup;ab\u{7}');
  expect(watcher.write('added 12 packages\r\n\u{1B}]77')).toBe(false);
  expect(watcher.write('03;beuve-se')).toBe(false);
  expect(watcher.write('tup;ab\u{7}$ ')).toBe(true);
  expect(watcher.write('\u{1B}]7703;beuve-setup;ab\u{7}')).toBe(false);
});

test('ignores the echoed command line and another run’s marker', ({ expect }) => {
  const watcher = new SetupMarkerWatcher('\u{1B}]7703;beuve-setup;ab\u{7}');
  expect(watcher.write(String.raw`printf '\033]7703;beuve-setup;ab\007'`)).toBe(false);
  expect(watcher.write('\u{1B}]7703;beuve-setup;cd\u{7}')).toBe(false);
});
