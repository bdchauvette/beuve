import type { InstallUnit } from './detect-install-units.ts';
import type { InstallConfig } from './install-config.ts';

/**
 * The detected units an install runs (ADR 0092): none when `.beuve/hooks/install` replaces them
 * (`hook: 'instead'`), else every unit whose ecosystem and row `skip` doesn't name.
 */
export function unitsToInstall(
  units: readonly InstallUnit[],
  config: InstallConfig,
): readonly InstallUnit[] {
  if (config.hook === 'instead') {
    return [];
  }
  const skipped = new Set<string>(config.skip);
  return units.filter((unit) => !skipped.has(unit.ecosystem) && !skipped.has(unit.tool));
}
