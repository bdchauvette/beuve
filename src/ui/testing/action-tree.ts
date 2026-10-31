/** An element of an {@link ActionTree}: what `delegateActions` reads, and its parent. */
export interface FakeElement {
  readonly dataset: Record<string, string>;
  readonly parent: FakeElement | undefined;
  getRootNode: () => unknown;
  contains: (other: unknown) => boolean;
}

/** A shadow root with fake elements in it, for delegation tests without a DOM. */
export interface ActionTree {
  /** The shadow root: a real `EventTarget` with `mode` and `host`. */
  readonly root: EventTarget;
  /** An element under `parent` (or the root), in `scope` (default: the root's tree). */
  element: (data: Record<string, string>, parent?: FakeElement, scope?: unknown) => FakeElement;
  /**
   * Dispatches a bubbling event of `type` at `target` with `init`'s properties, whose
   * `composedPath()` runs from `target` through its ancestors to the root.
   */
  dispatch: (type: string, target: FakeElement, init?: Readonly<Record<string, unknown>>) => Event;
  /** {@link dispatch} without properties, whose path goes on from the root through `beyond`. */
  dispatchBeyond: (type: string, target: FakeElement, beyond: readonly FakeElement[]) => Event;
}

/** A fresh {@link ActionTree}. */
export function actionTree(): ActionTree {
  const root = Object.assign(new EventTarget(), { mode: 'open', host: {} });
  const element = (
    data: Record<string, string>,
    parent?: FakeElement,
    scope: unknown = root,
  ): FakeElement => {
    const created: FakeElement = {
      dataset: { ...data },
      parent,
      getRootNode: (): unknown => {
        return scope;
      },
      contains: (other): boolean => {
        for (let node = other as FakeElement | undefined; node !== undefined; node = node.parent) {
          if (node === created) {
            return true;
          }
        }
        return false;
      },
    };
    return created;
  };
  const dispatchThrough = (
    type: string,
    target: FakeElement,
    { init = {}, beyond = [] }: DispatchOptions,
  ): Event => {
    const path: unknown[] = [];
    for (let node: FakeElement | undefined = target; node !== undefined; node = node.parent) {
      path.push(node);
    }
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(init)) {
      Object.defineProperty(event, key, { value });
    }
    Object.defineProperty(event, 'composedPath', {
      value: () => {
        return [...path, root, ...beyond];
      },
    });
    root.dispatchEvent(event);
    return event;
  };
  return {
    root,
    element,
    dispatch: (type, target, init): Event => {
      return dispatchThrough(type, target, { init: init ?? {} });
    },
    dispatchBeyond: (type, target, beyond): Event => {
      return dispatchThrough(type, target, { beyond });
    },
  };
}

/** The event's own properties, and the elements its path crosses after the root. */
interface DispatchOptions {
  readonly init?: Readonly<Record<string, unknown>>;
  readonly beyond?: readonly FakeElement[];
}
