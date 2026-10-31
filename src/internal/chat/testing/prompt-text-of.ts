/** A request, as far as reading its messages' text needs it. */
export interface PromptedRequest {
  readonly messages: readonly PromptMessage[];
}

/** A message, as far as reading its text needs it. */
export interface PromptMessage {
  readonly content: string;
}

/** A request's messages as one text, for asserting what a fake model was sent ('' for none). */
export function promptTextOf(request: PromptedRequest | undefined): string {
  return (request?.messages ?? []).map((message) => message.content).join('\n');
}
