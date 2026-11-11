import type { PullRequestView } from './ipc-contract.ts';

/**
 * A description sheet's window title and heading (ADR 0135): `#12 Title · description`, so a stack
 * of sheets tells it from the files beside it. Shared by main's window and the sheet page. Pure.
 */
export function descriptionSheetTitleFrom(
  pullRequest: Pick<PullRequestView, 'number' | 'title'>,
): string {
  return `#${String(pullRequest.number)} ${pullRequest.title} · description`;
}
