import type { ActionData, ActionHandler } from './dispatch-action.ts';

/**
 * A delegated action with a typed payload (ADR 0074): `parse` reads it from the element's
 * `data-*` attributes at the edge, and the action runs only when it parses.
 */
export function withPayload<P, E extends Event>(
  parse: (data: ActionData) => P | undefined,
  run: (payload: P, event: E, element: HTMLElement) => void,
): ActionHandler<E> {
  return (data, event, element): void => {
    const payload = parse(data);
    if (payload !== undefined) {
      run(payload, event, element);
    }
  };
}
