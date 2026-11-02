import type { UraItemView } from '#contract/ipc-contract.ts';

/** An item's title, or when it has none (titles are optional) the first line of its body. */
export function headlineOfUraItem(item: UraItemView): string {
  if (item.title !== '') {
    return item.title;
  }
  return item.body.trim().split('\n', 1)[0] ?? '';
}
