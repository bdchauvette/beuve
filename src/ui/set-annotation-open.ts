/**
 * Opens or closes an annotation made with `createAnnotationHead` (ADR 0155): the body `build`
 * makes is appended when it opens and dropped when it closes, and the toggle says which.
 */
export function setAnnotationOpen(
  root: HTMLElement,
  build: () => HTMLElement,
  isOpen: boolean,
): void {
  root.querySelector('.annotation-toggle')?.setAttribute('aria-expanded', String(isOpen));
  root.classList.toggle('open', isOpen);
  const body = root.querySelector(':scope > .annotation-body');
  if (isOpen && body === null) {
    const built = build();
    built.classList.add('annotation-body');
    root.append(built);
  } else if (!isOpen && body !== null) {
    body.remove();
  }
}
