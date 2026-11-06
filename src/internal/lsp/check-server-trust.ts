import type { DefinitionOrigin, ServerSource } from './server-definition.ts';

/** What is about to run, so the check can say whether it may (ADR 0111). */
export type ServerTrustRequest = ServerProgramRequest | CheckoutEnvironmentRequest;

/** A language server's program is about to start in a checkout. */
export interface ServerProgramRequest {
  readonly kind: 'server-program';
  readonly serverId: string;
  readonly source: ServerSource;
  readonly origin: DefinitionOrigin;
  /** The checkout the server would run in. */
  readonly root: string;
}

/** A login shell is about to run in a checkout to read its environment. */
export interface CheckoutEnvironmentRequest {
  readonly kind: 'checkout-environment';
  readonly root: string;
}

/** Allowed, or denied with a reason the reviewer can read. */
export type ServerTrustDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * The single decision point for starting something in a checkout (ADR 0111). Version one answers
 * from fixed rules and fails closed: `builtin` and `path` programs are allowed; a `project`
 * program only when the reviewer's own configuration defined the server, which counts as their
 * consent; the environment of a checkout is allowed, because direnv's and mise's own trust decides
 * what their shells load there (ADR 0095); anything else is denied. How trust is granted or
 * remembered is not decided yet, so nothing here consults a store.
 */
export function checkServerTrust(request: ServerTrustRequest): ServerTrustDecision {
  if (request.kind === 'checkout-environment') {
    return { allowed: true };
  }
  switch (request.source) {
    case 'builtin':
    case 'path': {
      return { allowed: true };
    }
    case 'project': {
      if (request.origin === 'reviewer') {
        return { allowed: true };
      }
      return denied(request.serverId);
    }
    default: {
      return denied(request.serverId);
    }
  }
}

function denied(serverId: string): ServerTrustDecision {
  return {
    allowed: false,
    reason: `The ${serverId} language server from this project was not started: it is not trusted.`,
  };
}
