import type { AgentInsightView } from '#contract/ipc-contract.ts';
import type { AgentInsight } from '#internal/review/agent-insight.ts';

/** The review domain's insight as plain contract data. */
export function toAgentInsightView(insight: AgentInsight): AgentInsightView {
  return {
    id: insight.id,
    runId: insight.runId,
    path: insight.path,
    lineStart: insight.lineStart,
    lineEnd: insight.lineEnd,
    severity: insight.severity,
    category: insight.category,
    title: insight.title,
    body: insight.body,
    confidence: insight.confidence,
    status: insight.status,
    model: insight.model,
    createdAt: insight.createdAt,
  };
}
