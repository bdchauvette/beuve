import { html } from 'lit';
import type { TemplateResult } from 'lit';

import type { CommitInfoView } from '#contract/ipc-contract.ts';

import './beuve-story-frame.ts';

/** A story's markup in a {@link BeuveStoryFrame}, with the commits it may answer for. */
export function framed(
  content: TemplateResult,
  commits: readonly CommitInfoView[] = [],
): TemplateResult {
  return html`<beuve-story-frame .content=${content} .commits=${commits}></beuve-story-frame>`;
}
