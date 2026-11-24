# 0157. One title band beside a full-height sidebar, progress in the status bar, and finishing actions

- Status: Accepted; amends [0142](0142-undo-save-progress-and-review-range.md), [0146](0146-opening-progress-and-reload-review.md) and [0156](0156-export-saves-progress.md)
- Date: 2026-11-24

## Context

The window stacked two bars over the diff: a title bar ("beuve", the review's name, Reload) across the whole window, then the diff stream's summary row (the scope, a range menu, the commits, the counts, progress, the order and display controls and a large Save Progress button). The title bar was mostly empty, the summary row was crowded, and the scope and the range menu side by side ("Up to date", "Since last saved progress ▾") read as two names for one thing. The sidebar started below the title bar, wherever it sat.

What the window says falls into levels: which review is open, its state (CI, whose turn, new commits), what the diff shows, the reviewer's progress, and how the diff is displayed. The Overview tab already holds a pull request's details. Now that copying the review saves progress (ADR 0156), Save Progress is rarely pressed, but whether the head is saved matters more, because a save can happen without a click.

## Decision

- **The sidebar runs the full height of the window**, on either side; the title band runs over the main column only. The sidebar's tabs are its part of the band: as tall as the title bar, on its background, and they drag the window. `beuve-app` slots `beuve-titlebar` into `beuve-review` (`slot="titlebar"`), at the top of the main column. On macOS the window buttons sit at the window's left edge: with the sidebar on the right the title bar leaves room for them, and with it on the left the tabs do (`--beuve-titlebar-inset`, `--beuve-sidebar-tabs-inset`, set by `beuve-review` from its `sidebar-left` attribute).
- **The title band says what is open and what the diff shows.** In order: the review's name, without "beuve" (for a pull request it shows the Overview tab; otherwise it opens the Open dialog), ▾ for the Open dialog, a pull request's CI as a dot (which shows the Overview tab, where the checks are listed), whose turn it is, Reload (ADR 0146), then the range menu, now named by what the diff shows (`rangeTriggerLabelFrom`: the scope itself since the last save, "Whole change", or the scope "since an earlier save"; plain text before the first save), the commits it spans and its file and line counts (left out for an empty diff). When the window narrows, whose turn gives way first, then the commits, then the name.
- **The status bar holds the reviewer's progress**: how many files are marked reviewed, with a small meter, and whether the head is saved (`saveStateFrom`): "Saved at abc1234 · 11:37", "Unsaved since abc1234" (accent) or "Not saved yet". Clicking it opens a popover that says what saving does, with Remove Last Saved Progress and Save Progress. CI and whose turn leave the status bar for the title band; the CI checks popover is gone, since the Overview tab lists the checks.
- **The diff stream loses its summary row.** The order and display controls, and a session error, sit right-aligned above the first card and scroll with the diff; they are also in the View menu. There is no Save Progress button: it is the Review menu's, with Cmd+S / Ctrl+S, and the status bar's.
- **Finishing actions.** Copying the review (ADR 0156) and Post Review to GitHub each end a round of review, and each saves progress at the head once it succeeds, keeping the review as shown (`finishRound`). A failed or refused post saves nothing.

## Consequences

- The window has one band over the diff instead of two rows, and every item in it is about the open review. The tabs line up with it, so the band reads as one row across the window.
- Progress and the save state sit together, in a place that never moves; the unsaved state is tinted so it is not missed there. A reviewer who never copies or posts saves with Cmd+S or the status bar.
- The CI checks are one click further away (Overview), in exchange for a status bar that holds only the app's own state beside the reviewer's progress.
- Whatever new finishing action comes later (a merge, say) saves progress the same way.

## Amendment 2026-11-24: What the diff shows moves to the status bar; the band ends with what it spans

- The range menu (named by the scope: "Full review", "Interdiff · exact", "Up to date") moves from the title band to the status bar, between the progress and the save state, so everything about where the reviewer is in the review sits together. It opens upward there; its choices reach the session from `beuve-app`.
- The title band ends, right-aligned, with what the diff spans: `abc1234..def5678 · 3 files · +5 −1` (`beuve-review-diffstat`, formerly `beuve-review-scope`), middle dots between the parts and the line counts in the diff's added and removed colors. The separator after Reload is gone.
- `beuve-commit` no longer renders a space after its hash: the hash and its card are joined with no whitespace, which also removes the gap in `abc1234 ..def5678` everywhere a hash sits in running text.

## Amendment 2026-11-24: The status bar names the branches

The title bar is for what the reviewer needs all the time; the status bar is for ambient facts worth a glance. The branches a review compares are the latter: the status bar shows them on its right, with a branch glyph (`displayIcon('branch')`), as `head → base` in the code font, ellipsized when the bar is tight, with "Reviewing head against base" on hover (`branchesFrom`). A local review names its refs (without `refs/heads/`), a pull request its branches on GitHub once it is loaded, and a followed branch the branch and, once known, the remote's default branch.

## Amendment 2026-11-24: Ambient facts leave the title bar

By the same rule, three more things move. A pull request's CI (a chip whose click runs `sidebar-overview`) and whose turn it is go back to the status bar's right side, after the branches. The commits the diff spans (`reviewSpanFrom`) move to the status bar after the range menu, each still opening on the remote; the title band ends with how big the diff is, `3 files · +5 −1` (`beuve-review-diffstat`). A local review's name drops its base (`folder · head`), which the status bar's branches give. The title bar now holds the review's name, the switcher, Reload and the diff's size.

## Amendment 2026-11-24: The status bar reads from broad to narrow, and its app state is icons

- The left side reads from broad to narrow: the branches, what the diff shows (the range menu) and the commits it spans, how many files are reviewed, whether the head is saved, then a transient notice. Progress no longer leads.
- The right side holds the ambient facts: whose turn, CI, a followed branch's state, then the language servers and GitHub sign-in as icon buttons (`displayIcon('braces')`, `displayIcon('account')`). Each has a status dot at its corner only when something needs a look (a server starting; signed out, gh missing or GitHub unavailable), its details in the tooltip, and its actions in a popover: the language servers' list and Restart, as before; for GitHub, Copy Sign-In Command (the remedy gh gives, `describeGithubAuth().remedy`) and Check Again.
- The app's version is gone from the status bar; it stays in the About window.
