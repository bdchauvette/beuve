import type { ChatController } from './chat-controller.ts';
import type { GithubController } from './github-controller.ts';
import type { ReviewDataController } from './review-data-controller.ts';
import type { ReviewEditsController } from './review-edits-controller.ts';
import type { SessionController } from './session-controller.ts';
import type { SettingsController } from './settings-controller.ts';
import type { UraController } from './ura-controller.ts';

/**
 * The state both containers read (ADR 0104): the controllers the shell builds and the review
 * container renders from. They have no DOM; each re-renders its host when its state changes, and
 * the shell passes a new `revision` down so the review re-renders with it.
 */
export interface AppModel {
  readonly session: SessionController;
  readonly github: GithubController;
  readonly settings: SettingsController;
  readonly reviewData: ReviewDataController;
  readonly ura: UraController;
  readonly reviewEdits: ReviewEditsController;
  readonly chat: ChatController;
}
