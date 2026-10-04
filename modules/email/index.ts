/** Email drafts (docs/25-email-drafts.md). The module's only public surface. */
export type { Attachment, Draft, DraftMode, DraftPurpose, DraftStatus, DraftWarning, MoveBlock, Prefill } from './types';
export { PURPOSE_LABEL } from './types';
export { draftWarnings, prefillDraft, type CheckInput, type PrefillInput } from './rules';
export {
  addAttachment, connectDemoMailguard, connectMailguard, createDraft, discardDraft, draftsOn, draftWithChecks, DraftRefused, forgetMailguard,
  mailStatus, mimeFor, moveBlocks, moveDraft, previewDraft, readAttachment, recipientFor, removeAttachment, saveDraft, testMailguard, warningsFor,
  type Actor, type DraftEdit, type MailStatus, type Moved, type NewDraft, type Preview, type Saved, type ThreadSource,
} from './service';
