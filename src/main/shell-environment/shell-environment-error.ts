/** Why the reviewer's login shell did not give its environment. Every variant is expected. */
export type ShellEnvironmentError =
  | { readonly kind: 'timed-out'; readonly timeout: Temporal.Duration }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'not-started'; readonly reason: string }
  | { readonly kind: 'failed'; readonly code: number | null; readonly stderr: string }
  | { readonly kind: 'unreadable'; readonly reason: string };
