import type {
  ComposerAttachment,
  InputActions,
} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots';

export type AddToMessageResult =
  /** The files are attached to the user's next message. */
  | 'added'
  /** The composer is sending a message and takes no attachments right now. */
  | 'busy'
  /** This web client has no composer that takes attachments from plugins. */
  | 'unavailable';

/**
 * The conversation service's draft attachments. DSH 0.2.1-rc.2 implements these on its
 * conversation service but does not publish them in `IConversation`, so they are
 * detected at run time, and the feature degrades to "unavailable" if they change.
 */
interface DraftAttachments {
  createDrafts(sessionId: SessionIdOf, files: readonly File[]): readonly ComposerAttachment[];
  releaseDraftAttachments?(attachments: readonly ComposerAttachment[]): void;
}

function draftAttachmentsOf(service: unknown): DraftAttachments | undefined {
  return typeof service === 'object' &&
    service !== null &&
    'createDrafts' in service &&
    typeof service.createDrafts === 'function'
    ? (service as DraftAttachments)
    : undefined;
}

/** Attaches files to the session's next message, as if the user had picked them. */
export function addToMessage(
  conversation: unknown,
  sessionId: SessionIdOf,
  files: readonly File[],
  inputActions: InputActions | undefined,
): AddToMessageResult {
  const drafts = draftAttachmentsOf(conversation);
  if (drafts === undefined || inputActions === undefined) return 'unavailable';
  const created = drafts.createDrafts(sessionId, files);
  if (inputActions.addAttachments(created.map((draft) => draft.id))) return 'added';
  drafts.releaseDraftAttachments?.(created);
  return 'busy';
}
