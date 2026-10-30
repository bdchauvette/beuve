import type { ZoneId } from './zones.ts';

/** Shell actions `beuve-app` performs itself. */
export type AppAction =
  | 'open'
  | 'palette'
  | 'go-to-file'
  | 'cycle-zone'
  | 'shortcuts'
  | 'chat'
  | 'add-to-chat'
  | 'tree-mode'
  | 'toggle-sidebar'
  | 'flip-sidebar'
  | 'sidebar-overview'
  | 'sidebar-review'
  | 'sidebar-chat'
  | 'find'
  | 'toggle-generated';

/** What running a command from the palette does. */
export type CommandRun =
  | { readonly kind: 'app'; readonly action: AppAction }
  /** Focuses the zone and presses the key there, so the zone's own handler runs it. */
  | {
      readonly kind: 'zone-key';
      readonly zone: ZoneId;
      readonly key: string;
      readonly isShifted?: boolean;
    }
  /**
   * A chat command: runs `text` at once, or, when it takes an argument, opens the chat with
   * `text` typed for the reviewer to finish.
   */
  | { readonly kind: 'slash'; readonly text: string; readonly isPrefill: boolean }
  /** Describes a key that only means something in place (typing in the chat, a portal). */
  | { readonly kind: 'none' };

/** Where a shortcut works. */
export type CommandScope = 'Anywhere' | 'Diff' | 'Review' | 'Chat' | 'Files';

export interface CommandDefinition {
  readonly id: string;
  /** What the palette and the shortcuts overlay call it. */
  readonly title: string;
  readonly scope: CommandScope;
  /** Display names of its shortcuts; empty for palette- or chat-only commands. */
  readonly keys: readonly string[];
  /** The chat command and its usage, e.g. `/editor zed|vscode|cursor`. */
  readonly slash?: string;
  /** The `/help` line after the usage; defaults to the title. */
  readonly help?: string;
  /** False for spec keys that aren't built yet. */
  readonly available: boolean;
  readonly run: CommandRun;
}

const none: CommandRun = { kind: 'none' };

/**
 * Every command beuve has, in the order the shortcuts overlay lists them: the spec 5A keys, the
 * shell's own and the chat's slash commands. The keybinding overlay, `/help`, the palette and the
 * key handlers' documentation all read this list, so they can't drift apart.
 */
export const commandRegistry: readonly CommandDefinition[] = Object.freeze([
  {
    id: 'palette',
    title: 'Command palette',
    scope: 'Anywhere',
    keys: ['⌘K', '⌘⇧P'],
    available: true,
    run: app('palette'),
  },
  {
    id: 'open',
    title: 'Open a pull request, branch or recent review…',
    scope: 'Anywhere',
    keys: ['⌘O'],
    available: true,
    run: app('open'),
  },
  {
    id: 'go-to-file',
    title: 'Go to file…',
    scope: 'Anywhere',
    keys: ['⌘P'],
    available: true,
    run: app('go-to-file'),
  },
  {
    id: 'cycle-zone',
    title: 'Cycle focus between regions',
    scope: 'Anywhere',
    keys: ['Tab', 'Shift+Tab'],
    available: true,
    run: app('cycle-zone'),
  },
  {
    id: 'shortcuts',
    title: 'Show keyboard shortcuts',
    scope: 'Anywhere',
    keys: ['?'],
    available: true,
    run: app('shortcuts'),
  },
  {
    id: 'chat',
    title: 'Open / focus the chat input (again to close)',
    scope: 'Anywhere',
    keys: ['c'],
    available: true,
    run: app('chat'),
  },
  {
    id: 'add-to-chat',
    title: 'Add selection to chat: the selected lines, hunk, staged note or file',
    scope: 'Anywhere',
    keys: ['⌘>'],
    available: true,
    run: app('add-to-chat'),
  },
  {
    id: 'tree-mode',
    title: 'Toggle diff-only file tree',
    scope: 'Anywhere',
    keys: ['f'],
    available: true,
    run: app('tree-mode'),
  },
  {
    id: 'toggle-sidebar',
    title: 'Show / hide the sidebar',
    scope: 'Anywhere',
    keys: ['\\'],
    available: true,
    run: app('toggle-sidebar'),
  },
  {
    id: 'sidebar-overview',
    title: 'Sidebar: intent and files',
    scope: 'Anywhere',
    keys: ['1'],
    available: true,
    run: app('sidebar-overview'),
  },
  {
    id: 'sidebar-review',
    title: 'Sidebar: staged review',
    scope: 'Anywhere',
    keys: ['2'],
    available: true,
    run: app('sidebar-review'),
  },
  {
    id: 'sidebar-chat',
    title: 'Sidebar: chat',
    scope: 'Anywhere',
    keys: ['3'],
    available: true,
    run: app('sidebar-chat'),
  },
  {
    id: 'find',
    title: 'Find in review (every file’s diff, collapsed ones too)',
    scope: 'Anywhere',
    keys: ['⌘F'],
    available: true,
    run: app('find'),
  },
  {
    id: 'toggle-generated',
    title: 'Show / collapse generated files',
    scope: 'Anywhere',
    keys: [],
    available: true,
    run: app('toggle-generated'),
  },
  {
    id: 'flip-sidebar',
    title: 'Move the sidebar to the other side',
    scope: 'Anywhere',
    keys: [],
    slash: '/sidebar left|right',
    help: 'put the sidebar on the left or the right (remembered in settings.json)',
    available: true,
    run: app('flip-sidebar'),
  },
  {
    id: 'next-hunk',
    title: 'Next hunk (across files)',
    scope: 'Diff',
    keys: ['j'],
    available: true,
    run: zoneKey('diff', 'j'),
  },
  {
    id: 'previous-hunk',
    title: 'Previous hunk',
    scope: 'Diff',
    keys: ['k'],
    available: true,
    run: zoneKey('diff', 'k'),
  },
  {
    id: 'expand',
    title: 'Load / collapse the file’s diff (lockfiles, generated and large diffs start collapsed)',
    scope: 'Diff',
    keys: ['Space'],
    available: true,
    run: zoneKey('diff', ' '),
  },
  {
    id: 'peek',
    title: 'Call-stack peek (callers)',
    scope: 'Diff',
    keys: ['p'],
    available: true,
    run: zoneKey('diff', 'p'),
  },
  {
    id: 'flow',
    title: 'Control-flow graph of the function (Enter shows the code)',
    scope: 'Diff',
    keys: ['Shift+p'],
    available: true,
    run: zoneKey('diff', 'P', true),
  },
  {
    id: 'trace',
    title:
      'Trace probe: run the tests covering the hunk and show what executed (asks once per repository)',
    scope: 'Diff',
    keys: ['r'],
    available: true,
    run: zoneKey('diff', 'r'),
  },
  {
    id: 'close-portal',
    title: 'Close the peek, flow or trace portal (stops a running probe)',
    scope: 'Diff',
    keys: ['Esc'],
    available: true,
    run: zoneKey('diff', 'Escape'),
  },
  {
    id: 'next-insight',
    title: 'Next agent insight',
    scope: 'Diff',
    keys: [']'],
    available: true,
    run: zoneKey('diff', ']'),
  },
  {
    id: 'previous-insight',
    title: 'Previous agent insight',
    scope: 'Diff',
    keys: ['['],
    available: true,
    run: zoneKey('diff', '['),
  },
  {
    id: 'promote-insight',
    title: 'Stage the agent insight in the review (again to withdraw)',
    scope: 'Diff',
    keys: ['y'],
    available: true,
    run: zoneKey('diff', 'y'),
  },
  {
    id: 'dismiss-insight',
    title: 'Dismiss / restore the agent insight',
    scope: 'Diff',
    keys: ['d'],
    available: true,
    run: zoneKey('diff', 'd'),
  },
  {
    id: 'stage',
    title: 'Stage the selected lines, hunk or file as a note',
    scope: 'Diff',
    keys: ['m'],
    available: true,
    run: zoneKey('diff', 'm'),
  },
  {
    id: 'suggest-edit',
    title: 'Suggest an edit to the hunk or selected lines (⌘Enter saves, files are never written)',
    scope: 'Diff',
    keys: ['e'],
    available: true,
    run: zoneKey('diff', 'e'),
  },
  {
    id: 'split-diff',
    title: 'Diffs side by side / inline',
    scope: 'Diff',
    keys: ['s'],
    available: true,
    run: zoneKey('diff', 's'),
  },
  {
    id: 'whitespace',
    title: 'Hide / show whitespace-only changes',
    scope: 'Diff',
    keys: ['w'],
    available: true,
    run: zoneKey('diff', 'w'),
  },
  {
    id: 'impact-details',
    title: 'ImpactGate details of the file (Esc closes)',
    scope: 'Diff',
    keys: ['i'],
    available: true,
    run: zoneKey('diff', 'i'),
  },
  {
    id: 'open-in-editor',
    title: 'Open in your editor at this line',
    scope: 'Diff',
    keys: ['o'],
    available: true,
    run: zoneKey('diff', 'o'),
  },
  {
    id: 'dock-move',
    title: 'Review: next / previous item',
    scope: 'Review',
    keys: ['j', 'k'],
    available: true,
    run: zoneKey('ura', 'j'),
  },
  {
    id: 'dock-show',
    title: 'Review: show the item in the diff',
    scope: 'Review',
    keys: ['Enter'],
    available: true,
    run: zoneKey('ura', 'Enter'),
  },
  {
    id: 'dock-edit',
    title: 'Review: edit title, body and severity',
    scope: 'Review',
    keys: ['Space'],
    available: true,
    run: zoneKey('ura', ' '),
  },
  {
    id: 'dock-withdraw',
    title: 'Review: withdraw / restore the item',
    scope: 'Review',
    keys: ['x'],
    available: true,
    run: zoneKey('ura', 'x'),
  },
  {
    id: 'dock-addressed',
    title: 'Review: mark addressed / restage',
    scope: 'Review',
    keys: ['a'],
    available: true,
    run: zoneKey('ura', 'a'),
  },
  {
    id: 'dock-reorder',
    title: 'Review: move the item down / up',
    scope: 'Review',
    keys: ['Shift+j', 'Shift+k'],
    available: true,
    run: zoneKey('ura', 'J', true),
  },
  {
    id: 'chat-ask',
    title: 'Chat: ask a question, or run a command',
    scope: 'Chat',
    keys: ['Enter'],
    available: true,
    run: none,
  },
  {
    id: 'chat-back',
    title: 'Chat: back to the diff',
    scope: 'Chat',
    keys: ['Esc'],
    available: true,
    run: none,
  },
  {
    id: 'chat-pills',
    title: 'Chat: move between citation pills and answer buttons',
    scope: 'Chat',
    keys: ['↑', '↓'],
    available: true,
    run: none,
  },
  {
    id: 'chat-chips',
    title:
      'Chat input: select the context chip beside the caret (Enter shows it, Backspace removes it)',
    scope: 'Chat',
    keys: ['←', '→'],
    available: true,
    run: none,
  },
  {
    id: 'review',
    title: 'Run a preliminary agentic review',
    scope: 'Chat',
    keys: [],
    slash: '/review',
    help: 'preliminary agentic review of the open session’s current head with your Claude Code login. Opt-in: the diff, ImpactGate findings and any worktree files Claude reads are sent to Anthropic under your Claude Code account’s terms.',
    available: true,
    run: slash('/review'),
  },
  {
    id: 'review-paths',
    title: 'Review only some paths…',
    scope: 'Chat',
    keys: [],
    slash: '/review <path-prefix>…',
    help: 'only files at or under these paths, e.g. /review src/ui docs/adr',
    available: true,
    run: slash('/review ', true),
  },
  {
    id: 'review-fresh',
    title: 'Rerun the review even if this head was reviewed',
    scope: 'Chat',
    keys: [],
    slash: '/review --fresh',
    help: 'rerun even if this head was reviewed (replaces its insights)',
    available: true,
    run: slash('/review --fresh'),
  },
  {
    id: 'review-effort',
    title: 'Review with more or less effort…',
    scope: 'Chat',
    keys: [],
    slash: '/review --effort=low|medium|high',
    help: 'how hard Claude Code thinks',
    available: true,
    run: slash('/review --effort=', true),
  },
  {
    id: 'editor',
    title: 'Choose the editor o opens…',
    scope: 'Chat',
    keys: [],
    slash: '/editor zed|vscode|cursor',
    help: 'choose the editor the o key opens (just /editor shows the current one)',
    available: true,
    run: slash('/editor ', true),
  },
  {
    id: 'diff-layout',
    title: 'Show diffs side by side or inline…',
    scope: 'Chat',
    keys: [],
    slash: '/diff split|inline',
    help: 'side-by-side or inline diffs (s in the diff; just /diff shows the current one)',
    available: true,
    run: slash('/diff ', true),
  },
  {
    id: 'whitespace-mode',
    title: 'Ignore or show whitespace-only changes…',
    scope: 'Chat',
    keys: [],
    slash: '/whitespace ignore|show',
    help: 'hide or show whitespace-only changes, computed by git diff -w (w in the diff)',
    available: true,
    run: slash('/whitespace ', true),
  },
  {
    id: 'generated-mode',
    title: 'Show or collapse generated files…',
    scope: 'Chat',
    keys: [],
    slash: '/generated show|hide',
    help: 'expand or collapse files .gitattributes marks linguist-generated (and minified bundles, source maps, protobuf output); remembered in settings.json',
    available: true,
    run: slash('/generated ', true),
  },
  {
    id: 'trust',
    title: 'Trust this repository’s tests for trace probes',
    scope: 'Chat',
    keys: [],
    slash: '/trust',
    help: 'allow this repository’s tests to run on this machine for trace probes (r). They execute the repository’s test code and Vitest config.',
    available: true,
    run: slash('/trust'),
  },
  {
    id: 'untrust',
    title: 'Stop trusting this repository’s tests',
    scope: 'Chat',
    keys: [],
    slash: '/untrust',
    help: 'withdraw that approval; r then asks again.',
    available: true,
    run: slash('/untrust'),
  },
  {
    id: 'compact-chat',
    title: 'Compact the chat into a summary',
    scope: 'Chat',
    keys: [],
    slash: '/compact',
    help: 'condense the conversation so far into a short note with its citations; later questions send the note instead of the older turns, which stay readable above it',
    available: true,
    run: slash('/compact'),
  },
  {
    id: 'clear-chat',
    title: 'Clear this session’s chat',
    scope: 'Chat',
    keys: [],
    slash: '/clear',
    help: 'delete this session’s chat (stops an answer in progress)',
    available: true,
    run: slash('/clear'),
  },
  {
    id: 'help',
    title: 'List the chat commands',
    scope: 'Chat',
    keys: [],
    slash: '/help',
    help: 'this list.',
    available: true,
    run: slash('/help'),
  },
] satisfies readonly CommandDefinition[]);

function zoneKey(zone: ZoneId, key: string, isShifted = false): CommandRun {
  return { kind: 'zone-key', zone, key, ...(isShifted && { isShifted }) };
}

function app(action: AppAction): CommandRun {
  return { kind: 'app', action };
}

function slash(text: string, isPrefill = false): CommandRun {
  return { kind: 'slash', text, isPrefill };
}
