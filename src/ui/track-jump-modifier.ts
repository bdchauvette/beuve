/**
 * Marks `host` with `data-jump` while ⌘ (Ctrl elsewhere) is held, so its styles can show that a
 * click on a token follows its definition. The mark clears when the window loses focus, since the
 * key-up then goes elsewhere. Listeners go with `signal`.
 */
export function trackJumpModifier(host: HTMLElement, signal: AbortSignal): void {
  const sync = (event: KeyboardEvent): void => {
    host.toggleAttribute('data-jump', event.metaKey || event.ctrlKey);
  };
  addEventListener('keydown', sync, { signal });
  addEventListener('keyup', sync, { signal });
  addEventListener(
    'blur',
    (): void => {
      host.toggleAttribute('data-jump', false);
    },
    { signal },
  );
  signal.addEventListener(
    'abort',
    (): void => {
      host.toggleAttribute('data-jump', false);
    },
    { once: true },
  );
}
