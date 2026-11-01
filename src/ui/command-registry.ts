import { commandCatalog } from '#contract/command-catalog.ts';
import type { CatalogCommand, CommandId } from '#contract/command-catalog.ts';

import type { ZoneId } from './zones.ts';

/** What running a command does in the main window. */
export type CommandRun =
  /** `beuve-app` runs it itself. */
  | { readonly kind: 'app' }
  /** Focuses the zone and hands it the command id, so the zone's own method runs it. */
  | { readonly kind: 'zone'; readonly zone: ZoneId }
  /**
   * A chat command: runs `text` at once, or, when it takes an argument, opens the chat with
   * `text` typed for the reviewer to finish.
   */
  | { readonly kind: 'slash'; readonly text: string; readonly isPrefill: boolean }
  /** Main runs it (Settings, About, …): the palette asks with `menu:run-main`. */
  | { readonly kind: 'main' }
  /** Describes a key that only means something in place (typing in the chat, a portal). */
  | { readonly kind: 'none' };

/** What the main window adds to a catalog command. */
interface CommandBehaviour {
  readonly run: CommandRun;
  /** The chat command and its usage, e.g. `/editor zed|vscode|cursor`. */
  readonly slash?: string;
  /** The `/help` line after the usage; defaults to the title. */
  readonly help?: string;
}

/** A catalog command (ADR 0068) with what running it does in the main window. */
export type CommandDefinition = CatalogCommand & CommandBehaviour & { readonly id: CommandId };

/**
 * Every catalog command with its behaviour in the main window, in catalog order. The palette, the
 * Keyboard Shortcuts window and `/help` read this list, and `menu:run` dispatches through it, so
 * no command can be in one and not the others. Titles and keys live in the catalog only.
 */
export const commandRegistry: readonly CommandDefinition[] = Object.freeze(registered());

function registered(): CommandDefinition[] {
  const table = behaviours();
  return commandCatalog.map((command): CommandDefinition => {
    return { ...command, ...table[command.id] };
  });
}

function behaviours(): Readonly<Record<CommandId, CommandBehaviour>> {
  const app: CommandBehaviour = { run: { kind: 'app' } };
  const main: CommandBehaviour = { run: { kind: 'main' } };
  const none: CommandBehaviour = { run: { kind: 'none' } };
  const diff: CommandBehaviour = { run: { kind: 'zone', zone: 'diff' } };
  const dock: CommandBehaviour = { run: { kind: 'zone', zone: 'ura' } };
  return {
    about: main,
    settings: main,
    open: app,
    'export-agent-xml': app,
    'export-agent-json': app,
    'export-github': app,
    'post-review': app,
    'close-all-sheets': main,
    'copy-permalink': app,
    'copy-relative-line': app,
    find: app,
    'find-next': app,
    'find-previous': app,
    'find-selection': app,
    'find-match-case': app,
    palette: app,
    'toggle-sidebar': app,
    'toggle-terminal': app,
    'sidebar-overview': app,
    'sidebar-review': app,
    'sidebar-chat': app,
    'sidebar-left': app,
    'sidebar-right': app,
    'flip-sidebar': {
      ...app,
      slash: '/sidebar left|right',
      help: 'put the sidebar on the left or the right (remembered in settings.json)',
    },
    'diff-split': {
      ...app,
      slash: '/diff split|inline',
      help: 'side-by-side or inline diffs (just /diff shows the current one)',
    },
    'diff-inline': app,
    whitespace: {
      ...app,
      slash: '/whitespace ignore|show',
      help: 'hide or show whitespace-only changes, computed by git diff -w',
    },
    'toggle-generated': {
      ...app,
      slash: '/generated show|hide',
      help: 'expand or collapse files .gitattributes marks linguist-generated (and minified bundles, source maps, protobuf output); remembered in settings.json',
    },
    'toggle-insights': {
      ...app,
      slash: '/insights show|hide',
      help: 'show or hide the /review findings as quiet notes on the diff lines; remembered in settings.json',
    },
    'tree-mode': app,
    'order-path': {
      ...app,
      slash: '/order path|imports|calls',
      help: 'the order the diff lists files in: path, imports (what a file uses comes first) or calls (asks the language server); config and mechanical files always go last. Remembered in settings.json; just /order shows the current one',
    },
    'order-imports': app,
    'order-calls': app,
    'sheets-window': {
      ...app,
      slash: '/sheets window|inline',
      help: 'definitions open in a new sheet window each, or over the diff (just /sheets shows the current one)',
    },
    'sheets-inline': app,
    expand: diff,
    collapse: diff,
    back: app,
    forward: app,
    'next-hunk': diff,
    'previous-hunk': diff,
    'next-file': diff,
    'previous-file': diff,
    'toggle-skip-reviewed': app,
    'go-to-file': app,
    'open-definition': app,
    'open-type-definition': app,
    'cycle-zone': app,
    'cycle-zone-back': app,
    'toggle-reviewed': app,
    'save-progress': app,
    stage: diff,
    'suggest-edit': diff,
    peek: diff,
    flow: diff,
    stop: app,
    'impact-details': diff,
    'open-in-editor': app,
    'editor-zed': {
      ...app,
      slash: '/editor zed|vscode|cursor',
      help: 'choose the editor Open in Editor uses (just /editor shows the current one)',
    },
    'editor-vscode': app,
    'editor-cursor': app,
    'open-review-edits': app,
    'harvest-review-edits': app,
    'discard-review-edits': app,
    'open-permalink': app,
    'commit-pairs': app,
    'dock-show': dock,
    'dock-edit': dock,
    'dock-withdraw': dock,
    'dock-addressed': dock,
    'dock-move-up': dock,
    'dock-move-down': dock,
    'dock-move': none,
    'restart-language-servers': app,
    chat: app,
    'add-to-chat': app,
    'stage-answer': app,
    summarize: {
      run: { kind: 'slash', text: '/summarize', isPrefill: false },
      slash: '/summarize',
      help: 'beuve’s own summary of the change, written from the diff and the code, never the pull request description: what changed, why (inferred), risky areas and files by purpose, with links',
    },
    abstract: {
      run: { kind: 'slash', text: '/abstract', isPrefill: false },
      slash: '/abstract',
      help: 'the same as /summarize',
    },
    review: {
      run: { kind: 'slash', text: '/review', isPrefill: false },
      slash: '/review',
      help: 'a preliminary review as a chat answer: findings with severity and confidence, each checked against the code by a second, cheaper pass (unconfirmed ones are dropped) and stageable one by one. Uses your Claude Code login; the diff, ImpactGate findings and any worktree files Claude reads are sent to Anthropic under your account’s terms.',
    },
    'review-paths': {
      run: { kind: 'slash', text: '/review ', isPrefill: true },
      slash: '/review <path-prefix>…',
      help: 'only files at or under these paths, e.g. /review src/ui docs/adr',
    },
    'review-fresh': {
      run: { kind: 'slash', text: '/review --fresh', isPrefill: false },
      slash: '/review --fresh',
      help: 'rerun even if the chat already reviewed this head and scope (otherwise that answer is repeated)',
    },
    'review-no-verify': {
      run: { kind: 'slash', text: '/review --no-verify', isPrefill: false },
      slash: '/review --no-verify',
      help: 'skip the second pass: faster and cheaper, but findings stay unchecked',
    },
    'review-effort-low': {
      run: { kind: 'slash', text: '/review --effort=low', isPrefill: false },
      slash: '/review --effort=low|medium|high',
      help: 'how hard Claude Code thinks',
    },
    'review-effort-medium': {
      run: { kind: 'slash', text: '/review --effort=medium', isPrefill: false },
    },
    'review-effort-high': {
      run: { kind: 'slash', text: '/review --effort=high', isPrefill: false },
    },
    'compact-chat': {
      run: { kind: 'slash', text: '/compact', isPrefill: false },
      slash: '/compact',
      help: 'condense the conversation so far into a short note with its citations; later questions send the note instead of the older turns, which stay readable above it',
    },
    'clear-queue': {
      run: { kind: 'slash', text: '/clear queue', isPrefill: false },
      slash: '/clear queue',
      help: 'drop only the questions and commands still waiting; the running answer goes on',
    },
    'clear-chat': {
      run: { kind: 'slash', text: '/clear', isPrefill: false },
      slash: '/clear',
      help: 'delete this session’s chat (stops the answer in progress and empties the queue)',
    },
    help: {
      run: { kind: 'slash', text: '/help', isPrefill: false },
      slash: '/help',
      help: 'this list.',
    },
    'chat-ask': none,
    'chat-back': none,
    'chat-pills': none,
    'chat-chips': none,
    'close-portal': none,
    'portal-walk': none,
    'sheet-cursor': none,
    'list-move': none,
    shortcuts: app,
    'github-home': main,
  };
}
