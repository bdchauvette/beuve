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
  { keys: ['Enter'], action: 'Chat: run the command (/review, /help)', available: true },
  { keys: ['Esc'], action: 'Chat: back to the diff stream', available: true },
  { keys: ['j', 'k'], action: 'Next / previous file', available: true },
  { keys: ['Space'], action: 'Expand / collapse', available: false },
  { keys: ['f'], action: 'Toggle diff-only tree', available: false },
  { keys: ['p'], action: 'Call-stack peek (callers)', available: true },
  { keys: ['Esc'], action: 'Close the peek portal', available: true },
  { keys: [']', '['], action: 'Next / previous agent insight', available: true },
  { keys: ['y'], action: 'Promote the agent insight (again to undo)', available: true },
  { keys: ['d'], action: 'Dismiss / restore the agent insight', available: true },
  { keys: ['Shift+p'], action: 'Control-flow graph', available: false },
  { keys: ['r'], action: 'Run trace probe', available: false },
  { keys: ['e'], action: 'Inline edit', available: false },
  { keys: ['m'], action: 'Stage into review dock', available: false },
  { keys: ['o'], action: 'Open in IDE', available: false },
]);
