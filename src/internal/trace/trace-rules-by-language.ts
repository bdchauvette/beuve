import { ecmascriptTraceRules } from './ecmascript-trace-rules.ts';
import type { TraceRules } from './trace-rules.ts';

/** Trace rules per syntax language id (the ids main's parser reports). */
export const traceRulesByLanguage: Readonly<Record<string, TraceRules | undefined>> = {
  typescript: ecmascriptTraceRules,
  tsx: ecmascriptTraceRules,
  javascript: ecmascriptTraceRules,
};
