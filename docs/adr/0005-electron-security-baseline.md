# 0005. Electron security baseline without eslint-plugin-electron

- Status: Accepted
- Date: 2026-10-28

## Context

The spec lists eslint-plugin-electron. The package was last published in 2022 and is not maintained, and its rules overlap with Electron's own security checklist.

## Decision

Drop eslint-plugin-electron. Enforce Electron's security checklist directly: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a strict Content-Security-Policy on the renderer, no `remote` module, IPC exposed only through a typed `contextBridge` API, and navigation and new-window creation denied by default. Add a local ESLint rule later if we find a pattern worth enforcing statically.

## Consequences

One fewer stale dependency. The security posture lives in code we review (`src/main` window creation, `src/preload`) rather than in a lint plugin. Because the preload runs sandboxed, it is bundled as CommonJS.
