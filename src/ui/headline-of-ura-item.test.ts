import { headlineOfUraItem } from './headline-of-ura-item.ts';
import { createUraItemView } from './testing/create-ura-item-view.ts';
import { test } from './testing/test.ts';

test('uses the title when there is one', ({ expect }) => {
  const item = createUraItemView({ title: 'Rename x', body: 'Because.' });
  expect(headlineOfUraItem(item)).toBe('Rename x');
});

test('falls back to the first line of the body', ({ expect }) => {
  const item = createUraItemView({ title: '', body: '\nNice work here.\nMore.' });
  expect(headlineOfUraItem(item)).toBe('Nice work here.');
});

test('is empty when there is neither', ({ expect }) => {
  expect(headlineOfUraItem(createUraItemView({ title: '', body: '' }))).toBe('');
});
