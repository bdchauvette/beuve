/** Which notes are dropped, on which note and on which side of it. */
export interface UraDrop {
  /** The dragged notes; the ones not `movable` stay where they are. */
  readonly ids: readonly string[];
  readonly targetId: string;
  readonly side: 'before' | 'after';
  /** The notes that may move and be dropped on: the staged ones (ADR 0143). */
  readonly movable: ReadonlySet<string>;
}

/**
 * The dock order after dropping notes beside another (ADR 0143), as Move Up and Move Down do one
 * step at a time: the dragged movable notes leave their places and land together, in their old
 * order, before or after the target, and the notes that aren't movable keep their places in
 * `order`. Unchanged when the target isn't movable, is one of the dragged notes, or nothing
 * movable is dragged. Pure.
 */
export function dropUraItems(order: readonly string[], drop: UraDrop): string[] {
  const dragged = new Set(drop.ids.filter((id) => drop.movable.has(id)));
  if (dragged.size === 0 || !drop.movable.has(drop.targetId) || dragged.has(drop.targetId)) {
    return [...order];
  }
  const movable = order.filter((id) => drop.movable.has(id));
  const rest = movable.filter((id) => !dragged.has(id));
  let at = rest.indexOf(drop.targetId);
  if (at === -1) {
    return [...order];
  }
  if (drop.side === 'after') {
    at += 1;
  }
  const landed = [
    ...rest.slice(0, at),
    ...movable.filter((id) => dragged.has(id)),
    ...rest.slice(at),
  ];
  let next = 0;
  return order.map((id) => {
    if (!drop.movable.has(id)) {
      return id;
    }
    const placed = landed[next] ?? id;
    next += 1;
    return placed;
  });
}
