# 0040. GitHub in the renderer, safe links, and development-only overrides

- Status: Accepted
- Date: 2026-10-28

## Context

Pull request bodies are untrusted Markdown with links; the renderer runs sandboxed with a strict CSP and cannot open anything itself (ADR 0005). The status bar must say whether beuve can talk to GitHub without exposing a token. And the app has to be driven end to end against a fake GitHub and a fake gh without a way for a packaged build to be pointed at another server.

## Decision

- **Intent section** (Zone 1, top, pull request sessions): title, state badge (Draft / Open / Merged / Closed), `owner/repo#n` and author, base ← head, the body through the insight Markdown subset (ADR 0022) extended with `https://` links (`[text](https://…)` and bare URLs), rendered as text nodes, and stack chips (↑ parents, ↓ children) that open the neighbour with `github:open-pr` in the same clone. The session list shows `#n`, the title and the state badge. "Open pull request" (URL or `owner/repo#n`, optional clone path) sits above "Open local repository", both collapsed once sessions exist.
- **Links**: a click emits `beuve-open-link`; `github:open-link { url }` opens it with `shell.openExternal` only if it is plain `https://` without credentials or port on `github.com` or a host of a stored pull request session; anything else is `refused` and the status bar says so. Navigation stays denied in the window.
- **Status bar**: the open pull request's CI rollup (a dot for the overall state, failing · pending · passing counts, the failing and pending check names as the tooltip) and the GitHub sign-in (`GitHub: @login via gh`, or `GitHub: not signed in — run gh auth login`), from `github:auth-status { host? }`, which returns `describe()` output only, never a token.
- **Development overrides**, both for driving a real window against fakes: `BEUVE_GH_PATH` (ADR 0034) points at a fake gh, and `BEUVE_GITHUB_API_URL` replaces the API root for every host. Main reads the latter only when `app.isPackaged` is false, accepts only an `http(s)` URL on `127.0.0.1`, `localhost` or `[::1]` with no credentials, query or fragment, and logs a warning when it is in use, so a token can never be sent to another machine through it. Tests inject `fetch` and the credential provider directly and need neither.

## Consequences

Untrusted Markdown can't run script or navigate, and only GitHub URLs leave the app. A packaged app always talks to `api.github.com` or `https://<host>/api/v3`. A development run with the override sends the real gh token to the loopback server if `BEUVE_GH_PATH` isn't also set to a fake, which is the developer's choice on their own machine.

## Amendment 2026-10-30: chat answers' links open any http(s) URL

A link in a chat answer (the Markdown view, ADR 0073) opens in the default browser whatever its host. The drawer still emits `beuve-open-link`; for the chat the app sends it to its own channel, `shell:open-url { url }`, whose handler parses the text with `URL` and passes the normalised `href` to `shell.openExternal` only for an absolute `https:` or `http:` URL; `file:`, `javascript:`, `data:`, editor and other schemes, and relative or unparsable text answer `invalid-request` and never reach the shell. The renderer already renders a link only for such a URL (`safeHrefFrom`), so main's check is the second gate. Pull request bodies, the review dock's "View on GitHub" and every other emitter stay on `github:open-link` and its GitHub-only rule. The window still never navigates. Consequence: a chat answer can now send the reviewer to any website, as a link in any document can; the URL shows in the link's tooltip before the click.
