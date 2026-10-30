/** A request's messages as one text, for asserting what a fake model was sent ('' for none). */
export function promptTextOf(
  request: { readonly messages: readonly { readonly content: string }[] } | undefined,
): string {
  return (request?.messages ?? []).map((message) => message.content).join('\n');
}
