import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { matchEmojiShortcodes } from './match-emoji-shortcodes.ts';

describe('matchEmojiShortcodes', () => {
  test('puts the exact name first, then prefixes, shorter first', ({ expect }) => {
    const names = matchEmojiShortcodes('heart').map((suggestion) => suggestion.name);
    expect(names).toStrictEqual([
      'heart',
      'hearts',
      'heartbeat',
      'heart_eyes',
      'heartpulse',
      'heart_hands',
      'heart_on_fire',
      'heart_eyes_cat',
    ]);
  });

  test('ranks shorter names first among prefixes', ({ expect }) => {
    const names = matchEmojiShortcodes('smil').map((suggestion) => suggestion.name);
    expect(names.slice(0, 3)).toStrictEqual(['smile', 'smiley', 'smile_cat']);
  });

  test('matches a later word, then inside a word, after the prefixes', ({ expect }) => {
    const names = matchEmojiShortcodes('thu').map((suggestion) => suggestion.name);
    expect(names).toStrictEqual([
      'thumbsup',
      'thumbsdown',
      'hand_with_index_finger_and_thumb_crossed',
      'lithuania',
    ]);
  });

  test('gives each emoji once, under its best-ranked name', ({ expect }) => {
    const suggestions = matchEmojiShortcodes('laugh');
    expect(suggestions[0]).toStrictEqual({ name: 'laughing', emoji: '😆' });
    expect(new Set(suggestions.map((suggestion) => suggestion.emoji)).size).toBe(
      suggestions.length,
    );
  });

  test('lists at most eight, and nothing for no match', ({ expect }) => {
    expect(matchEmojiShortcodes('a')).toHaveLength(8);
    expect(matchEmojiShortcodes('zzqx')).toStrictEqual([]);
    expect(matchEmojiShortcodes('')).toStrictEqual([]);
  });

  test('offers names with symbols', ({ expect }) => {
    expect(matchEmojiShortcodes('+1')[0]).toStrictEqual({ name: '+1', emoji: '👍' });
  });
});
