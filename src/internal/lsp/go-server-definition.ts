import type { ServerDefinition } from './server-definition.ts';

export interface GoServerOptions {
  /** Absolute path of the `gopls` executable; otherwise it is looked up on the reviewer's `PATH`. */
  readonly command?: string;
}

/**
 * The registry entry for `gopls` (ADR 0111). It is not shipped: it needs the reviewer's own Go
 * toolchain, so it is found on `PATH` (beuve's login-shell one, as for any IDE). A module is a
 * directory with a `go.mod`, so a repository with several gets a server each. What `gopls`
 * v0.24 was seen to do, and so what the settings are for (ADR 0111, "Go"):
 *
 * - With `GOTOOLCHAIN` left to its default, a `toolchain go1.99.0` line in the reviewed repository's
 *   `go.mod` made `go` ask the proxy for that toolchain's zip: a download of a program to run,
 *   chosen by the branch under review. `local` stops it, and `gopls` still works.
 * - `GOPROXY=off` makes a dependency that is not in the module cache a normal `BrokenImport`
 *   error instead of a download; the reviewer installs dependencies in the terminal (ADR 0095),
 *   after which the same error is gone.
 * - `GOFLAGS` is not passed on: with `-mod=mod` in it, `go` rewrote the checkout's `go.mod` and
 *   created a `go.sum`. Left alone, `go` defaults to `-mod=readonly` (or the vendor directory when
 *   there is one). A `GOFLAGS` set with `go env -w` lives in Go's own environment file, which
 *   this does not turn off; a reviewer who set `-mod=mod` there can override it in the config.
 * - `GOPATH`, `GOMODCACHE`, `GOCACHE` and `GOROOT` are passed on, so `go` finds the reviewer's
 *   module cache and toolchain; `XDG_*` so it finds the same cache and environment file.
 * - Analyzer findings (`printf`, `rangeint`, ...) arrive in a second phase, after the type check.
 *   With a quiet period of 500 ms beuve settled before they came and called the file clean;
 *   3 s received them.
 */
export function goServerDefinition(options: GoServerOptions = {}): ServerDefinition {
  return {
    id: 'gopls',
    command: options.command ?? 'gopls',
    args: [],
    languageIds: { '.go': 'go' },
    rootMarkers: ['go.mod'],
    source: 'path',
    env: { GOTOOLCHAIN: 'local', GOPROXY: 'off' },
    inheritEnv: ['GOPATH', 'GOMODCACHE', 'GOCACHE', 'GOROOT', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'],
    diagnosticsQuiet: Temporal.Duration.from({ seconds: 3 }),
  };
}
