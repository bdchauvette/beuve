import { isEditableElement } from './is-editable-element.ts';

/** Whether the focus, through shadow roots, is in a field that takes typing. */
export function isTextFocused(): boolean {
  let element: Element | null = document.activeElement;
  while (
    element?.shadowRoot?.activeElement !== undefined &&
    element.shadowRoot.activeElement !== null
  ) {
    element = element.shadowRoot.activeElement;
  }
  return element instanceof HTMLElement && isEditableElement(element);
}
