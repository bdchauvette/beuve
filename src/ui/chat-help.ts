/** What `/help` prints in the chat drawer (ADR 0022, 0031). */
export const chatHelp: readonly string[] = Object.freeze([
  'Type a question to ask Claude Code about the open change, e.g. “why does parse trim the first part?”. It reads the diff and the checked-out head, answers with links into the code, and never edits anything. Each question sends the question, the diff, ImpactGate findings, earlier turns and any worktree files Claude reads to Anthropic under your Claude Code account’s terms.',
  '/review — preliminary agentic review of the open session’s current head with your Claude Code login. Opt-in: the diff, ImpactGate findings and any worktree files Claude reads are sent to Anthropic under your Claude Code account’s terms.',
  '/review <path-prefix>… — only files at or under these paths, e.g. /review src/ui docs/adr',
  '/review --fresh — rerun even if this head was reviewed (replaces its insights)',
  '/review --effort=low|medium|high — how hard Claude Code thinks',
  '/editor zed|vscode|cursor — choose the editor the o key opens (just /editor shows the current one)',
  '/diff split|inline — side-by-side or inline diffs (s in the diff stream; just /diff shows the current one)',
  '/whitespace ignore|show — hide or show whitespace-only changes, computed by git diff -w (w in the diff stream)',
  '/trust — allow this repository’s tests to run on this machine for trace probes (r). They execute the repository’s test code and Vitest config.',
  '/untrust — withdraw that approval; r then asks again.',
  '/clear — delete this session’s chat (stops an answer in progress)',
  '/help — this list.',
]);
