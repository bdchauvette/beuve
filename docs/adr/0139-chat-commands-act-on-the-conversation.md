# 0139. Chat commands act on the conversation or the model, not on settings

- Status: Accepted
- Date: 2026-11-18

## Context

The chat input took seven slash commands that only set a preference: `/editor` (ADR 0033), `/diff` and `/whitespace` (ADR 0042), `/sidebar` (ADR 0044), `/generated` (ADR 0052), `/insights` (ADR 0061) and `/order` (ADR 0065). Each already had commands in the palette and, for most, the menus (ADR 0068). So a setting could be changed from three places, with a different readout in each: the chat printed a note into the transcript, the menus showed a checkmark and the status bar showed a notice. The chat is the reviewer's conversation with the model, and those notes sat in it as if they were part of the conversation. ADR 0068 already says a preference with a menu toggle is set only from the menu; the slash commands predate that rule and were never brought into line with it.

## Decision

- A chat command exists only to act on the conversation or ask the model for something: `/summarize` (and `/abstract`), `/review` and its options, `/compact`, `/clear` and `/clear queue`, and `/help`. A new setting is a catalog command (palette, menu) and never a chat command.
- `/editor`, `/diff`, `/whitespace`, `/generated`, `/insights`, `/order` and `/sidebar` are removed from the parser, the command registry's `slash` usages (so from `/help` and the completion list, ADR 0127) and the chat controller, which no longer takes a `runAppCommand`. Typing one answers with a note saying it sets a preference and where to set it, instead of "unknown command", so the habit ends with an explanation. Nothing is changed.
- Their palette and menu commands, and the status notices they show (`describeGenerated`, `describeInsights`, `describeOrder` and the others), stay as they were.

## Consequences

- One place to learn and one readout for each setting; `/help` and the completion list shrink to the commands about the conversation.
- The bare forms (`/diff`, `/order`, `/editor`) that showed the current value are gone. The menus show the current choice with a checkmark or radio item; the editor has no menu readout beyond the status notice after choosing one.
- The settings can't be changed from the keyboard without leaving the chat input; the palette is the keyboard route.
- This supersedes the chat-command parts of ADR 0033, 0042, 0044, 0052, 0061 and 0065; the rest of each stands.
