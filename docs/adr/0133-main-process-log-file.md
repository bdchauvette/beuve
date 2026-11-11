# 0133. The main process logs to a file Help can show

- Status: Accepted
- Date: 2026-11-11

## Context

The main process logged JSON lines to stderr only. Launched from a terminal that is fine; launched from Finder or the Dock, stderr goes nowhere, so the one place an unexpected failure is described (`register-ipc-handlers` logs the exception and sends the renderer only "internal error", by design) was unreachable. A reviewer who hit "internal error" while staging a note had no way to see why.

## Decision

- The main logger writes each line to stderr and to `main.log` in Electron's `logs` directory (`~/Library/Logs/beuve` on macOS, where Console.app also lists it). `openLogFile` (`#x/log/open-log-file.ts`) creates the directory 0700 and the file 0600, since lines name repositories and paths, and never throws.
- Each run starts its own file: the previous one moves to `main.previous.log`, so the logs hold two runs at most and need no rotation policy. Only the instance that holds the single-instance lock opens the file, so a second launch that hands over never rotates a running instance's log.
- Help › Show Log File (`show-log`, a main-process command) reveals the file in the file manager.
- An `internal` IPC error says "Internal error; Help › Show Log File has the details." The renderer still never sees a stack.

## Consequences

Failures are diagnosable from a packaged app without a terminal, and a reviewer can attach the file to a bug report. The log level stays `info` (`BEUVE_LOG_LEVEL` changes it). A long session's file grows without bound; that is accepted until a run produces a log large enough to matter.
