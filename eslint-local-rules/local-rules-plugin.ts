import { enforceInternalUtils } from './enforce-internal-utils.ts';
import { enforceSingleNamedExport } from './enforce-single-named-export.ts';
import { enforceTopLevelFunctionSyntax } from './enforce-top-level-function-syntax.ts';
import { exportNameMatchesFilename } from './export-name-matches-filename.ts';
import { noBarrelFiles } from './no-barrel-files.ts';

/**
 * Typed as loosely as typescript-eslint types its own plugin: ESLint's and typescript-eslint's
 * rule types are mutually unassignable, and ESLint validates rules at load time anyway.
 */
interface CompatiblePlugin {
  readonly meta: { readonly name: string };
}

const plugin = {
  meta: { name: 'local' },
  rules: {
    'enforce-internal-utils': enforceInternalUtils,
    'enforce-single-named-export': enforceSingleNamedExport,
    'enforce-top-level-function-syntax': enforceTopLevelFunctionSyntax,
    'export-name-matches-filename': exportNameMatchesFilename,
    'no-barrel-files': noBarrelFiles,
  },
};

/** beuve's project-specific ESLint rules, registered under the `local` prefix. */
export const localRulesPlugin: CompatiblePlugin = plugin;
