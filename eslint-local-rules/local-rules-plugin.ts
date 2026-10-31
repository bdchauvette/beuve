import { arrowBodyBraces } from './arrow-body-braces.ts';
import { enforceInternalUtils } from './enforce-internal-utils.ts';
import { forwardAbortSignal } from './forward-abort-signal.ts';
import { expectFromTestContext } from './expect-from-test-context.ts';
import { enforceSingleNamedExport } from './enforce-single-named-export.ts';
import { enforceTopLevelFunctionSyntax } from './enforce-top-level-function-syntax.ts';
import { exportNameMatchesFilename } from './export-name-matches-filename.ts';
import { noBarrelFiles } from './no-barrel-files.ts';
import { noCheckThenOpen } from './no-check-then-open.ts';
import { noDate } from './no-date.ts';
import { noElectronAsNode } from './no-electron-as-node.ts';
import { noHandFormattedDuration } from './no-hand-formatted-duration.ts';
import { noListenerInRepeatedTemplate } from './no-listener-in-repeated-template.ts';
import { noInlineObjectTypeInSignature } from './no-inline-object-type-in-signature.ts';
import { noModuleMocking } from './no-module-mocking.ts';
import { noModuleScopeBindings } from './no-module-scope-bindings.ts';
import { noSameTypePositionalParams } from './no-same-type-positional-params.ts';
import { noStringTailSlice } from './no-string-tail-slice.ts';
import { noTernaryOutsideTemplates } from './no-ternary-outside-templates.ts';
import { noTimeNumberArithmetic } from './no-time-number-arithmetic.ts';
import { preferErrorFrom } from './prefer-error-from.ts';
import { preferUrlParse } from './prefer-url-parse.ts';
import { preferUsing } from './prefer-using.ts';
import { requireSequentialFakeTime } from './require-sequential-fake-time.ts';

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
    'arrow-body-braces': arrowBodyBraces,
    'enforce-internal-utils': enforceInternalUtils,
    'enforce-single-named-export': enforceSingleNamedExport,
    'enforce-top-level-function-syntax': enforceTopLevelFunctionSyntax,
    'expect-from-test-context': expectFromTestContext,
    'export-name-matches-filename': exportNameMatchesFilename,
    'forward-abort-signal': forwardAbortSignal,
    'no-barrel-files': noBarrelFiles,
    'no-check-then-open': noCheckThenOpen,
    'no-date': noDate,
    'no-electron-as-node': noElectronAsNode,
    'no-hand-formatted-duration': noHandFormattedDuration,
    'no-listener-in-repeated-template': noListenerInRepeatedTemplate,
    'no-inline-object-type-in-signature': noInlineObjectTypeInSignature,
    'no-module-mocking': noModuleMocking,
    'no-module-scope-bindings': noModuleScopeBindings,
    'no-same-type-positional-params': noSameTypePositionalParams,
    'no-string-tail-slice': noStringTailSlice,
    'no-ternary-outside-templates': noTernaryOutsideTemplates,
    'no-time-number-arithmetic': noTimeNumberArithmetic,
    'prefer-error-from': preferErrorFrom,
    'prefer-url-parse': preferUrlParse,
    'prefer-using': preferUsing,
    'require-sequential-fake-time': requireSequentialFakeTime,
  },
};

/** beuve's project-specific ESLint rules, registered under the `local` prefix. */
export const localRulesPlugin: CompatiblePlugin = plugin;
