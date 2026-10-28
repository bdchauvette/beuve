/** What `/help` prints in the chat drawer (ADR 0022). */
export const chatHelp: readonly string[] = Object.freeze([
  '/review — preliminary agentic review of the open session’s current head with your Claude Code login. Opt-in: the diff, ImpactGate findings and any worktree files Claude reads are sent to Anthropic under your Claude Code account’s terms.',
  '/review <path-prefix>… — only files at or under these paths, e.g. /review src/ui docs/adr',
  '/review --fresh — rerun even if this head was reviewed (replaces its insights)',
  '/review --effort=low|medium|high — how hard Claude Code thinks',
  '/help — this list. Questions about the change (Q&A) arrive later; the chat never edits files.',
]);
