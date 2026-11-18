const editorId = /^[a-z][a-z0-9-]{0,39}$/u;

/**
 * Whether `value` can name an editor (ADR 0140): lowercase letters, digits and dashes, starting
 * with a letter, at most 40 characters. Whether such an editor is configured is another question.
 */
export function isEditorId(value: unknown): boolean {
  return typeof value === 'string' && editorId.test(value);
}
