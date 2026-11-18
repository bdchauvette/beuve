/** Which items move, which way, and which items may trade places with them. */
export interface UraMove {
  readonly ids: readonly string[];
  readonly step: 1 | -1;
  readonly movable: ReadonlySet<string>;
}

/**
 * The dock order after moving the `ids` one place (`step` is 1 or -1) among the `movable` items:
 * each swaps with the nearest movable neighbor in that direction that isn't moving too, so staged
 * items reorder around withdrawn ones without disturbing them, and several selected ones move
 * together (ADR 0143). One that reaches an end stays there, and the ones behind it close up. Ids
 * that aren't movable stay put. Pure.
 */
export function moveUraItems(order: readonly string[], { ids, step, movable }: UraMove): string[] {
  const moving = new Set(ids.filter((id) => movable.has(id)));
  const sequence = order.filter((id) => movable.has(id));
  const indexes = sequence.map((_id, index) => index);
  if (step === 1) {
    indexes.reverse();
  }
  for (const index of indexes) {
    const id = sequence[index];
    const neighbor = sequence[index + step];
    if (id === undefined || neighbor === undefined || !moving.has(id) || moving.has(neighbor)) {
      continue;
    }
    sequence[index + step] = id;
    sequence[index] = neighbor;
  }
  let next = 0;
  return order.map((id) => {
    if (!movable.has(id)) {
      return id;
    }
    const placed = sequence[next] ?? id;
    next += 1;
    return placed;
  });
}
