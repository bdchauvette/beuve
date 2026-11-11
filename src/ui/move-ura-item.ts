/** Which item moves, which way, and which items may trade places with it. */
export interface UraMove {
  readonly id: string;
  readonly step: 1 | -1;
  readonly movable: ReadonlySet<string>;
}

/**
 * The dock order after moving `id` one place (`step` is 1 or -1) among the `movable` items: it
 * swaps with the nearest movable neighbor in that direction, so staged items reorder around
 * withdrawn ones without disturbing them. The order is returned unchanged at either end, or when
 * `id` isn't movable.
 */
export function moveUraItem(order: readonly string[], { id, step, movable }: UraMove): string[] {
  const moved = [...order];
  const from = moved.indexOf(id);
  if (from === -1 || !movable.has(id)) {
    return moved;
  }
  for (let to = from + step; to >= 0 && to < moved.length; to += step) {
    const neighbor = moved[to];
    if (neighbor !== undefined && movable.has(neighbor)) {
      moved[to] = id;
      moved[from] = neighbor;
      return moved;
    }
  }
  return moved;
}
