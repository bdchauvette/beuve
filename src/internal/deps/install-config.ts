import type { Ecosystem, ToolId } from './dependency-ecosystem.ts';

/** A step the repository (or the reviewer's override) adds: an argument vector, run without a shell. */
export interface InstallStep {
  readonly run: readonly string[];
  /** Relative to the checkout, normalised, never leaving it; `''` is the top level. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The `install` section of `.beuve/config.json`, or of the per-repository override in Settings,
 * which has the same shape and wins field by field (ADR 0092).
 */
export interface InstallConfig {
  /** Ecosystems (`python`) or rows (`pip`) whose detected installs don't run. */
  readonly skip?: readonly (Ecosystem | ToolId)[];
  /** Run after the detected installs, in order. */
  readonly steps?: readonly InstallStep[];
  /** `instead`: `.beuve/hooks/install` replaces the detected installs; `after` (default) follows them. */
  readonly hook?: 'after' | 'instead';
  /** The whole install's limit. Defaults to 15 minutes. */
  readonly timeoutSeconds?: number;
}
