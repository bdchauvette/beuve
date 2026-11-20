import type { ReviewThreadView } from '#contract/ipc-contract.ts';

import { createThreadElement } from './create-thread-element.ts';
import { setAnnotationOpen } from './set-annotation-open.ts';

/** Opens or closes a thread made by `createThreadAnnotation`: open, every comment shows (ADR 0155). */
export function setThreadOpen(root: HTMLElement, thread: ReviewThreadView, isOpen: boolean): void {
  setAnnotationOpen(
    root,
    (): HTMLElement => {
      const body = document.createElement('div');
      body.append(createThreadElement(thread, { showsPlace: false }));
      return body;
    },
    isOpen,
  );
}
