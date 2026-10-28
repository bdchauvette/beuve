import { ecmascriptRules } from './ecmascript-rules.ts';
import type { LanguageRules } from './language-rules.ts';

/** ImpactGate rules per syntax language id (the ids main's parser reports). */
export const rulesByLanguage: Readonly<Record<string, LanguageRules | undefined>> = {
  typescript: ecmascriptRules,
  tsx: ecmascriptRules,
  javascript: ecmascriptRules,
};
