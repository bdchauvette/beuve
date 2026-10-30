import type { ReviewOrderView } from '#contract/ipc-contract.ts';

const reasons: Readonly<Record<NonNullable<ReviewOrderView['fallback']>['kind'], string>> = {
  'no-language-server': 'no language server answered',
  'no-call-edges': 'no calls between the changed files',
  'no-source-files': 'no TypeScript or JavaScript to read',
};

/**
 * Why the files are not in the order asked for (ADR 0065), e.g. `calls: no language server
 * answered, so imports`; `undefined` when the order is the one asked for. Pure.
 */
export function describeOrderFallback(order: ReviewOrderView | undefined): string | undefined {
  return order?.fallback === undefined || order.mode === order.requestedMode
    ? undefined
    : `${order.requestedMode}: ${reasons[order.fallback.kind]}, so ${order.mode}`;
}
