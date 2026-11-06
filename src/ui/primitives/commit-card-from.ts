import type { CommitInfoView, CommitSignatureView } from '#contract/ipc-contract.ts';

/** What a commit hash's card says (ADR 0116). */
export interface CommitCard {
  readonly subject: string;
  readonly body: string;
  readonly author: CommitSignatureView;
  /** The committer, when someone else committed it or it was committed later (a rebase, an amend). */
  readonly committer?: CommitSignatureView;
  /** "Parent 1a2b3c4", "Merge of 1a2b3c4 and 5d6e7f8", or "Root commit". */
  readonly parents: string;
}

/**
 * The card for a commit: the committer only when the commit was not committed by its author
 * within a minute of writing it, and its parents in a phrase. Pure.
 */
export function commitCardFrom(info: CommitInfoView, abbreviation: number): CommitCard {
  const card = {
    subject: info.subject,
    body: info.body,
    author: info.author,
    parents: parentsText(info.parents.map((parent) => parent.slice(0, abbreviation))),
  };
  if (isCommittedByAuthor(info)) {
    return card;
  }
  return { ...card, committer: info.committer };
}

function isCommittedByAuthor({ author, committer }: CommitInfoView): boolean {
  if (author.name !== committer.name || author.email !== committer.email) {
    return false;
  }
  const committed = Temporal.Instant.from(committer.at);
  const gap = Temporal.Instant.from(author.at).until(committed).abs();
  return Temporal.Duration.compare(gap, { minutes: 1 }) <= 0;
}

function parentsText(parents: readonly string[]): string {
  const [first, ...rest] = parents;
  if (first === undefined) {
    return 'Root commit';
  }
  if (rest.length === 0) {
    return `Parent ${first}`;
  }
  return `Merge of ${new Intl.ListFormat('en', { type: 'conjunction' }).format(parents)}`;
}
