/**
 * The negative control of `scripts/check-hostile-render.ts` (ADR 0077): a `default` policy that
 * admits every string unchanged, the policy ADR 0077 rejects. `node scripts/build.ts
 * --hostile-harness --pass-through-policy` builds the harness page installing it in place of
 * `installTrustedTypesPolicy`, and the check must then fail. No shipped entry can reach it.
 */
export function installPassThroughPolicy(): void {
  globalThis.trustedTypes?.createPolicy('default', {
    createHTML: (html: string): string => {
      return html;
    },
    createScriptURL: (url: string): string => {
      return url;
    },
  });
}
