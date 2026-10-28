import { ecmascriptFlowRules } from './ecmascript-flow-rules.ts';
import type { FlowRules } from './flow-rules.ts';

/** Flow rules per syntax language id (the ids main's parser reports). */
export const flowRulesByLanguage: Readonly<Record<string, FlowRules | undefined>> = {
  typescript: ecmascriptFlowRules,
  tsx: ecmascriptFlowRules,
  javascript: ecmascriptFlowRules,
};
