/** An element's `data-*` attributes, as `dataset` gives them: what a delegated action acts on. */
export type ActionData = Readonly<Record<string, string | undefined>>;

/** Runs a `data-action`: its element's data, the event, and the element itself. */
export type ActionHandler<E extends Event> = (
  data: ActionData,
  event: E,
  element: HTMLElement,
) => void;

/** Handlers by `data-action` value. */
export type ActionHandlers<E extends Event> = Readonly<Record<string, ActionHandler<E>>>;

/** Elements whose keys are their own (ADR 0068): text fields, and the forms they are in. */
const editingTags: ReadonlySet<string> = new Set(['input', 'textarea', 'select', 'form']);

/** Events that run as enter and leave. */
const crossingTypes: ReadonlySet<string> = new Set([
  'pointerover',
  'pointerout',
  'mouseover',
  'mouseout',
  'focusin',
  'focusout',
]);

/**
 * Runs the handler named by the `data-action` of the innermost element on `event.composedPath()`,
 * before the listener's own target, that is in `scope` (a shadow root or document) and has a
 * handler (ADR 0074). Elements of other trees, such as nested components' shadow roots, are
 * theirs to handle; an action without a handler is passed over for an ancestor's.
 *
 * - `pointerover`/`pointerout`, `mouseover`/`mouseout` and `focusin`/`focusout` run as enter and
 *   leave: a move between descendants of the matched element is skipped.
 * - A key event with Ctrl or ⌘ is a chord, which only the menu dispatches (ADR 0068), and is
 *   not handled, unless it was typed in a text field or a form: those keep their keys (⌘↩ saves).
 */
export function dispatchAction(
  event: Event,
  scope: unknown,
  handlers: ActionHandlers<Event> | undefined,
): void {
  if (handlers === undefined || isChord(event)) {
    return;
  }
  for (const target of event.composedPath()) {
    if (target === event.currentTarget) {
      return;
    }
    if (!isActionElement(target) || target.getRootNode() !== scope) {
      continue;
    }
    const action = target.dataset['action'];
    const handler = action === undefined ? undefined : handlers[action];
    if (handler === undefined) {
      continue;
    }
    if (!isMoveWithin(event, target)) {
      handler(target.dataset, event, target as unknown as HTMLElement);
    }
    return;
  }
}

interface ActionElement {
  readonly dataset: ActionData;
  getRootNode: () => unknown;
  contains: (other: unknown) => boolean;
}

function isChord(event: Event): boolean {
  if (!('key' in event)) {
    return false;
  }
  const { ctrlKey, metaKey } = event as KeyboardEvent;
  return (ctrlKey || metaKey) && !isTyped(event);
}

/** Typed in a text field or a form, before the listener's own target. */
function isTyped(event: Event): boolean {
  for (const target of event.composedPath()) {
    if (target === event.currentTarget) {
      return false;
    }
    const { localName, isContentEditable } = target as {
      readonly localName?: unknown;
      readonly isContentEditable?: unknown;
    };
    if (
      isContentEditable === true ||
      (typeof localName === 'string' && editingTags.has(localName))
    ) {
      return true;
    }
  }
  return false;
}

function isActionElement(target: EventTarget): target is EventTarget & ActionElement {
  const { dataset } = target as { readonly dataset?: unknown };
  return typeof dataset === 'object' && dataset !== null && 'getRootNode' in target;
}

/** An over, out, focusin or focusout whose other side is inside `element` too. */
function isMoveWithin(event: Event, element: ActionElement): boolean {
  const { relatedTarget } = event as { readonly relatedTarget?: unknown };
  return (
    relatedTarget !== undefined &&
    relatedTarget !== null &&
    crossingTypes.has(event.type) &&
    element.contains(relatedTarget)
  );
}
