/** Email drafts (docs/25-email-drafts.md). The module's only public surface. */
export type { Attachment, Draft, DraftMode, DraftPurpose, DraftStatus, DraftWarning, MoveBlock, Prefill } from './types';
export { PURPOSE_LABEL } from './types';
export { draftWarnings, prefillDraft, type CheckInput, type PrefillInput } from './rules';
export {
  addAttachment, createDraft, discardDraft, disconnectGmail, draftsOn, draftWithChecks, DraftRefused, finishGmailConnect, gmailStatus,
  mimeFor, moveBlocks, moveDraft, previewDraft, readAttachment, removeAttachment, saveDraft, warningsFor,
  type Actor, type DraftEdit, type GmailStatus, type Moved, type NewDraft, type Preview, type Saved,
} from './service';
