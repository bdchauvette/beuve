# 0098. A `beuve://` link opens a pull request

- Status: Accepted
- Date: 2026-11-02

## Context

A reviewer reading a pull request in the browser wants to continue in beuve without copying the URL: a bookmarklet, a link in chat, a Shortcuts action. An OS share sheet entry is not an option. macOS needs a separate Share Extension (an `.appex` in Swift or Objective-C, sandboxed, with its own signing), which electron-builder does not build and an ad-hoc signed dmg does not suit; Linux has no share sheet. A custom URL scheme reaches the same goal from any of those callers.

## Decision

- **Scheme**: `beuve://open?url=<pull request URL>`, with the URL percent-encoded. `pullRequestLinkFrom` (`src/internal/github/`) accepts only the `open` action, exactly one `url` parameter and a plain `https://` pull request URL as `parsePullRequestRef` reads it (any GitHub host; no `owner/repo#n` shorthand, no credentials, no port). Anything else is refused with a message. Other targets (compare URLs, commits, repositories) are not supported yet; each would be a new action here.
- **Registration**: `protocols` in `electron-builder.yml` writes `CFBundleURLTypes` on macOS and the `x-scheme-handler/beuve` MIME type into the Linux desktop entry. A development run (`npm start`) registers nothing, and an AppImage is registered only if the user integrates it with the desktop. beuve does not call `setAsDefaultProtocolClient`.
- **Delivery**: macOS delivers `open-url`, possibly before `ready`; elsewhere the link is an argument of the first launch or of `second-instance`. `index.ts` pushes both into a `LinkInbox`, which keeps links until `startApp` attaches its handler and ignores arguments that are not `beuve://`.
- **Consent**: any web page can trigger a link, and opening a pull request fetches into a local checkout. Main asks before acting (a message box, "Open pull request host/owner/repo#n?"), and an unreadable link shows an error box instead. After consent, main focuses a main window (opening one if none) and sends `link:open-pr { ref }`; the renderer runs its normal `github:open-pr`, so the clone lookup, `needs-local-clone` and failure messages are unchanged. beuve still never pushes (ADR 0088).

## Consequences

- A bookmarklet is `location.href='beuve://open?url='+encodeURIComponent(location.href)`; the browser asks once per site before launching beuve.
- A link costs one extra click, the price of not letting web pages start fetches unprompted.
- The renderer gains one push channel; nothing it can invoke changes, and the CSP is untouched.
- Registration needs a packaged app. Moving the app to `/Applications` (or a first launch) is what makes macOS register the scheme.
- A share sheet or Services entry remains out of scope; it would reuse this scheme from a native helper.
