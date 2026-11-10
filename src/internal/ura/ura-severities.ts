/**
 * A URA item's label: the Conventional Comments labels (https://conventionalcomments.org/) plus
 * beuve's own `smell`, in the order the composer offers them, the common ones first (ADR 0131).
 * Whether a note blocks the merge is the separate `blocking` decoration, not the label.
 *
 * `issue`: something is wrong. `suggestion`: a proposed improvement. `question`: needs an answer
 * rather than a change. `nitpick`: a trivial, preference-based request. `thought`: an idea that
 * came up, asking for nothing. `smell`: nothing is actually wrong, but it feels off. `praise`:
 * something done well. `note`: something to be aware of. `todo`: a small, necessary change.
 * `chore`: a task to do before the change is accepted. `typo`: a misspelling. `polish`: nothing
 * is wrong, but the quality could be raised. `quibble`: a trivial preference, like a nitpick.
 */
export const uraSeverities = [
  'issue',
  'suggestion',
  'question',
  'nitpick',
  'thought',
  'smell',
  'praise',
  'note',
  'todo',
  'chore',
  'typo',
  'polish',
  'quibble',
] as const;

export type UraSeverity = (typeof uraSeverities)[number];
