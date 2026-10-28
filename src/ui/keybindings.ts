export interface Keybinding {
  readonly keys: readonly string[];
  readonly action: string;
  readonly available: boolean;
}

/** The keyboard map of spec 5A. `available` marks what the shell already handles. */
export const keybindings: readonly Keybinding[] = Object.freeze([
  { keys: ['Tab', 'Shift+Tab'], action: 'Cycle zones', available: true },
  { keys: ['?'], action: 'Show this overlay', available: true },
  { keys: ['c'], action: 'Toggle the chat drawer', available: true },
  { keys: ['j', 'k'], action: 'Next / previous file', available: true },
  { keys: ['Space'], action: 'Expand / collapse', available: false },
  { keys: ['f'], action: 'Toggle diff-only tree', available: false },
  { keys: ['p'], action: 'Call-stack peek', available: false },
  { keys: ['Shift+p'], action: 'Control-flow graph', available: false },
  { keys: ['r'], action: 'Run trace probe', available: false },
  { keys: ['e'], action: 'Inline edit', available: false },
  { keys: ['m'], action: 'Stage into review dock', available: false },
  { keys: ['o'], action: 'Open in IDE', available: false },
]);
