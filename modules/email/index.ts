/** Email drafts (docs/25-email-drafts.md). The module's only public surface. */
export type { Attachment, Draft, DraftMode, DraftPurpose, DraftStatus, DraftWarning, EmailKind, MoveBlock, Prefill } from './types';
export { KIND_LABEL, PURPOSE_LABEL } from './types';
export {
  chooseFirstEmail, draftWarnings, firstMessageProblems, prefillDraft, readFirstMessage, STEPS,
  type CheckInput, type EmailPlan, type FirstMessageInput, type PrefillInput, type RouteHint,
} from './rules';
export {
  addAttachment, connectDemoMailguard, connectMailguard, createDraft, discardDraft, draftsOn, draftWithChecks, DraftRefused, forgetMailguard,
  mailStatus, mimeFor, moveBlocks, moveDraft, previewDraft, readAttachment, recipientFor, removeAttachment, saveDraft, saveVoice, testMailguard,
  voiceOf, VOICE_LIMITS, warningsFor,
  type Actor, type DraftEdit, type MailStatus, type Moved, type NewDraft, type Preview, type Saved, type ThreadSource, type Voice,
} from './service';
