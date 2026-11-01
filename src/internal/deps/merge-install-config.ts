import type { InstallConfig } from './install-config.ts';

/** The checkout's `.beuve/config.json` and the reviewer's override from Settings, either absent. */
export interface InstallConfigSources {
  readonly checkout: InstallConfig | undefined;
  readonly override: InstallConfig | undefined;
}

/**
 * The configuration an install uses (ADR 0092): each field the override sets wins over the
 * checkout's, field by field (`steps` is replaced whole, not appended); fields neither sets are
 * absent, so the defaults apply.
 */
export function mergeInstallConfig({ checkout, override }: InstallConfigSources): InstallConfig {
  return { ...checkout, ...override };
}
