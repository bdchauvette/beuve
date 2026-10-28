import type { GithubReviewPreviewView, UraVerdictView } from '#contract/ipc-contract.ts';

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
  const parts = [
    inlineCount > 0 ? plural(inlineCount, 'inline comment') : '',
    bodyCount > 0 ? `${String(bodyCount)} in the review body` : '',
  ].filter((part) => part !== '');
  const what = parts.length === 0 ? 'No new items, only the verdict' : parts.join(' and ');
  const earlier =
    alreadyPostedCount === 0
      ? ''
      : ` ${plural(alreadyPostedCount, 'item')} already posted ${alreadyPostedCount === 1 ? 'stays' : 'stay'} out.`;
  return `${what}, as ${events[preview.verdict]}, on ${preview.headSha.slice(0, 12)}.${earlier}`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
