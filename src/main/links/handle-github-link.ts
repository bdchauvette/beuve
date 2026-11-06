import { githubLinkFrom } from '#internal/github/github-link-from.ts';

/** What a confirmed link opens: a pull request (`host/owner/repo#n`) or a branch (`…:branch`). */
export interface GithubLinkTarget {
  readonly kind: 'pull-request' | 'branch';
  readonly text: string;
}

/** What {@link handleGithubLink} needs from the desktop. */
export interface GithubLinkActions {
  /** Asks whether to open `target`; false if declined. */
  readonly confirm: (target: GithubLinkTarget) => Promise<boolean>;
  /** Tells the user the link was not one beuve can open. */
  readonly reportInvalid: (reason: string) => void;
  /** Shows `target` in a main window and opens it there with `github:open-pr` or `github:open-branch`. */
  readonly open: (target: GithubLinkTarget) => void;
}

/**
 * Acts on a `beuve://open?url=<pull request or tree URL>` link (ADR 0098, 0112). A web page can
 * trigger a link, and opening fetches into a local checkout, so the reviewer confirms first.
 */
export async function handleGithubLink(link: string, actions: GithubLinkActions): Promise<void> {
  const parsed = githubLinkFrom(link);
  if (!parsed.ok) {
    actions.reportInvalid(parsed.error);
    return;
  }
  const target: GithubLinkTarget = { kind: parsed.value.kind, text: parsed.value.text };
  if (await actions.confirm(target)) {
    actions.open(target);
  }
}
