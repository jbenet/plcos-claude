/** Email drafts (docs/25-email-drafts.md). The module's only public surface. */
export type { Attachment, Draft, DraftMode, DraftPurpose, DraftStatus, DraftWarning, EmailKind, MoveBlock, Prefill } from './types';
export { KIND_LABEL, PURPOSE_LABEL } from './types';
export {
  chooseFirstEmail, draftWarnings, firstMessageProblems, prefillDraft, readFirstMessage, STEPS,
  type CheckInput, type EmailPlan, type FirstMessageInput, type PrefillInput, type RouteHint,
} from './rules';
export {
  addAttachment, createDraft, discardDraft, disconnectGmail, draftsOn, draftWithChecks, DraftRefused, finishGmailConnect, gmailStatus,
  mimeFor, moveBlocks, moveDraft, previewDraft, readAttachment, removeAttachment, saveDraft, saveVoice, voiceOf, VOICE_LIMITS, warningsFor,
  type Actor, type DraftEdit, type GmailStatus, type Moved, type NewDraft, type Preview, type Saved, type Voice,
} from './service';
