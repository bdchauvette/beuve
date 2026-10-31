import type { GithubReviewPreviewView, UraVerdictView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';
import { nounFor } from './noun-for.ts';

const events: Readonly<Record<UraVerdictView, string>> = {
  approve: 'Approve',
  comment: 'Comment',
  'request-changes': 'Request changes',
};

/**
 * The confirmation line before posting: `2 inline comments and 1 in the review body, as Comment,
 * on 1a2b3c4d5e6f.` Items an earlier review carried are counted separately. Pure.
 */
export function describeReviewPreview(preview: GithubReviewPreviewView): string {
  const { inlineCount, bodyCount, alreadyPostedCount } = preview;
  const parts: string[] = [];
  if (inlineCount > 0) {
    parts.push(countNoun(inlineCount, 'inline comment'));
  }
  if (bodyCount > 0) {
    parts.push(`${String(bodyCount)} in the review body`);
  }
  if (parts.length === 0) {
    parts.push('No new items, only the verdict');
  }
  return `${parts.join(' and ')}, as ${events[preview.verdict]}, on ${preview.headSha.slice(0, 12)}.${earlierText(alreadyPostedCount)}`;
}

function earlierText(alreadyPostedCount: number): string {
  if (alreadyPostedCount === 0) {
    return '';
  }
  const stay = nounFor(alreadyPostedCount, { one: 'stays', other: 'stay' });
  return ` ${countNoun(alreadyPostedCount, 'item')} already posted ${stay} out.`;
}
