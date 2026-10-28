/**
 * The dock order after moving `id` one place (`step` is 1 or -1) among the `movable` items: it
 * swaps with the nearest movable neighbour in that direction, so staged items reorder around
 * withdrawn ones without disturbing them. The order is returned unchanged at either end, or when
 * `id` isn't movable.
 */
export function moveUraItem(
  order: readonly string[],
  id: string,
  step: 1 | -1,
  movable: ReadonlySet<string>,
): string[] {
  const moved = [...order];
  const from = moved.indexOf(id);
  if (from === -1 || !movable.has(id)) {
    return moved;
  }
  for (let to = from + step; to >= 0 && to < moved.length; to += step) {
    const neighbour = moved[to];
    if (neighbour !== undefined && movable.has(neighbour)) {
      moved[to] = id;
      moved[from] = neighbour;
      return moved;
    }
  }
  return moved;
}
