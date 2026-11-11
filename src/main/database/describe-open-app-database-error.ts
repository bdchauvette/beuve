import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import type { OpenAppDatabaseError } from './open-app-database.ts';

/** The text of the dialog beuve shows before quitting on a database it won't open. */
export interface OpenAppDatabaseErrorDescription {
  readonly message: string;
  readonly detail: string;
}

/** Says why beuve can't start on its database and what the reviewer can do (ADR 0137). */
export function describeOpenAppDatabaseError(
  error: OpenAppDatabaseError,
): OpenAppDatabaseErrorDescription {
  return {
    message: 'beuve’s database was written by a newer version of beuve',
    detail: [
      `${revealFormatControls(error.location)} has schema changes this version doesn’t know (${error.unknownIds.join(', ')}), so beuve left it untouched and can’t start on it.`,
      'Install the newer version of beuve to keep using it.',
    ].join('\n\n'),
  };
}
