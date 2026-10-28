export interface Keybinding {
  readonly keys: readonly string[];
  readonly action: string;
  readonly available: boolean;
}

/** The keyboard map of spec 5A. `available` marks what the shell already handles. */
export const keybindings: readonly Keybinding[] = Object.freeze([
  { keys: ['Tab', 'Shift+Tab'], action: 'Cycle zones', available: true },
  { keys: ['?'], action: 'Show this overlay', available: true },
  { keys: ['c'], action: 'Open / focus the chat input (again to close)', available: true },
  {
    keys: ['Enter'],
    action: 'Chat: ask a question, or run a command (/review, /clear, /help)',
    available: true,
  },
  { keys: ['Esc'], action: 'Chat: back to the diff stream', available: true },
  {
    keys: ['↑', '↓'],
    action: 'Chat: move between citation pills and answer buttons (Enter activates)',
    available: true,
  },
  { keys: ['j', 'k'], action: 'Next / previous hunk (across files)', available: true },
  { keys: ['Space'], action: 'Expand / collapse', available: false },
  { keys: ['f'], action: 'Toggle diff-only tree', available: true },
  { keys: ['p'], action: 'Call-stack peek (callers)', available: true },
  { keys: ['Esc'], action: 'Close the peek or flow portal', available: true },
  { keys: [']', '['], action: 'Next / previous agent insight', available: true },
  {
    keys: ['y'],
    action: 'Stage the agent insight in the dock (again to withdraw)',
    available: true,
  },
  { keys: ['d'], action: 'Dismiss / restore the agent insight', available: true },
  {
    keys: ['m'],
    action: 'Stage the selected lines, hunk or file as a note (Enter saves, Esc cancels)',
    available: true,
  },
  { keys: ['j', 'k'], action: 'Dock: next / previous item', available: true },
  { keys: ['Enter'], action: 'Dock: show the item in the diff stream', available: true },
  { keys: ['Space'], action: 'Dock: edit title, body and severity', available: true },
  { keys: ['x'], action: 'Dock: withdraw / restore the item', available: true },
  { keys: ['a'], action: 'Dock: mark addressed / restage', available: true },
  { keys: ['Shift+j', 'Shift+k'], action: 'Dock: move the item down / up', available: true },
  {
    keys: ['Shift+p'],
    action: 'Control-flow graph of the function (Enter shows the code)',
    available: true,
  },
  { keys: ['r'], action: 'Run trace probe', available: false },
  { keys: ['e'], action: 'Inline edit', available: false },
  {
    keys: ['o'],
    action: 'Open in your editor at this line (diff stream, dock item or chat citation)',
    available: true,
  },
]);
