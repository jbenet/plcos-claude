import { auth } from '@/lib/auth';
import { formatDate } from '@/lib/time';
import { VOICE_LIMITS, voiceOf } from '@/modules/email';
import { VoiceForm } from './VoiceForm';

/**
 * Preferences → Your voice (docs/email-guidelines.md §Voice): how you write, in a few lines, and
 * three to five emails you sent. Whoever drafts for you reads it — the Email box shows it beside the
 * editor, and the strategy writers get it with the research export. Yours only, kept here, never
 * used for training; saving it empty deletes it.
 */
export async function VoiceCard() {
  const user = await (await auth()).currentUser();
  if (user.access === 'viewer') return null;
  const v = await voiceOf(user);
  return (
    <div className="card" id="voice">
      <div className="chead">
        <h2>Your voice</h2>
        <span className="lbl">for drafts written for you · yours only{v.updatedAt ? ` · saved ${formatDate(v.updatedAt, { day: 'numeric', month: 'short' })}` : ''}</span>
      </div>
      <div className="cbody">
        <p style={{ marginTop: 0 }}>
          Drafts in Capital OS should sound like you. Write a few lines on how you write — how you open, how long you go,
          how you sign off, words you use and words you never would — and paste three to five emails you sent that read
          like you at your best. Pick them yourself, and take out anything about other people you would not want a
          drafter to see.
        </p>
        <VoiceForm style={v.style} samples={v.samples} limits={VOICE_LIMITS} />
      </div>
      <p className="cover">
        <b>Your own words, kept here.</b> Only you can read or change this. It is shown to whoever drafts for you —
        you in the Email box, and the strategy writers (W5) through the research export — and to nobody else. It is
        never used to train a model. Deleting it removes it; the log keeps only that it changed and how long it was.
      </p>
    </div>
  );
}
