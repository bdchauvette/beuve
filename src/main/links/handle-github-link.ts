import { pullRequestLinkFrom } from '#internal/github/pull-request-link-from.ts';

/** What {@link handlePullRequestLink} needs from the desktop. */
export interface PullRequestLinkActions {
  /** Asks whether to open the pull request `text` (`host/owner/repo#n`); false if declined. */
  readonly confirm: (text: string) => Promise<boolean>;
  /** Tells the user the link was not one beuve can open. */
  readonly reportInvalid: (reason: string) => void;
  /** Shows `text` in a main window and opens it there with `github:open-pr`. */
  readonly open: (text: string) => void;
}

/**
 * Acts on a `beuve://open?url=<pull request URL>` link (ADR 0098). A web page can trigger a link,
 * and opening a pull request fetches into a local checkout, so the reviewer confirms first.
 */
export async function handlePullRequestLink(
  link: string,
  actions: PullRequestLinkActions,
): Promise<void> {
  const parsed = pullRequestLinkFrom(link);
  if (!parsed.ok) {
    actions.reportInvalid(parsed.error);
    return;
  }
  if (await actions.confirm(parsed.value.text)) {
    actions.open(parsed.value.text);
  }
}
