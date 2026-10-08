import { demoMailguardAction, forgetMailguardAction, readCalendarsAction } from '@/app/email/actions';
import { getDb } from '@/lib/db';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { mailStatus } from '@/modules/email';
import { keyFor, mailguardRuntime } from '@/lib/connectors/mailguard';
import { maskSecret } from '@/lib/settings/store';
import { PasteToken, TestConnection } from './MailguardForms';

/** What each capability lets the token do, in words. */
const SAYS: Record<string, string> = {
  draft: 'make and update its own drafts',
  'read.metadata': 'read message headers, never bodies, to reply in a thread',
  'read.body': 'read message bodies',
  'read.attachments': 'download attachments',
  'organize.labels': 'add and remove labels',
  'organize.inbox': 'archive',
  'organize.read': 'mark read or unread',
  'organize.star': 'star',
  'organize.spam': 'mark spam',
  'organize.trash': 'move mail to the trash',
  'labels.manage': 'create, rename and delete labels',
  'calendar.freebusy': 'see when you are busy',
  'calendar.read': 'read your meetings: times and guests',
  'calendar.read.details': 'read meeting descriptions',
  'calendar.write.staged': 'propose calendar changes for you to approve',
  'calendar.write': 'add events to your calendar',
  'calendar.edit': 'change and delete events',
};

/** What the calendar line says (issue 0021): read only, or why not. */
const CALENDAR: Record<string, string> = {
  unsupported: 'not read: this mailguard has no calendar yet (it arrives in mailguard v0.9).',
  off: 'not read: mailguard’s policy does not include the calendar.',
  reconnect: 'not read yet: choose “Add calendar” in mailguard’s Settings and reconnect Google once.',
  no_read: 'not read: give this tool calendar.read in mailguard to see your meetings next to LPs.',
};

/**
 * Preferences → Email (docs/25 §12): the person's mailguard token, which puts drafts written here into
 * their own Gmail Drafts. Only a token that mailguard says cannot send is accepted; it is checked when
 * pasted, at server start, before every move and daily, and drafting stops if it fails.
 */
export async function MailguardConnect() {
  const user = await (await auth()).currentUser();
  if (user.access === 'viewer') return null;
  const g = await mailStatus(user);
  // Your own key, never anyone else's, and never in full: •••• and the last four of a long one.
  const rt = mailguardRuntime();
  const mine = rt.mode === 'off' ? null : await keyFor(rt, user.handle).catch(() => null);
  const kept = rt.mode !== 'off' && rt.store.kind === 'database' ? 'kept encrypted in the app' : 'kept in the Keychain';
  const where = g.mode === 'fake' ? 'the demo’s fake mailguard' : g.mode === 'mailguard' ? 'mailguard' : 'off';
  const lastRead = g.calendar?.state === 'ok'
    ? await (await getDb()).one<{ at: Date | string; status: string; note: string | null }>(`select coalesce(finished_at, started_at) at, status, note from sources.sync_run where source = 'calendar' order by id desc limit 1`).catch(() => null)
    : null;
  return (
    <div className="card" id="email">
      <div className="chead">
        <h2>Email</h2>
        <span className="lbl">your Gmail, through {where} · drafts only</span>
      </div>
      <div className="cbody">
        {g.mode === 'off' ? (
          <p style={{ marginTop: 0 }}>{g.why}</p>
        ) : g.connected && g.ok ? (
          <>
            <div className="fact"><span>Mailbox</span><span>{g.mailbox}</span></div>
            <div className="fact"><span>Token</span><span>{mine ? <span className="mono">{maskSecret(mine.key)}</span> : null} tool “{g.tool}” · {g.source === 'keychain' ? 'from the Keychain item plcos-claude / mailguard-token' : `pasted here, ${kept}`}</span></div>
            <div className="fact"><span>May</span><span>{g.capabilities.map((c) => SAYS[c] ?? c).join('; ')}. It cannot send: mailguard refuses sends for this token, and this tool has no send in it.</span></div>
            <div className="fact"><span>Calendar</span><span>{g.calendar?.state === 'ok'
              ? <>read only: your meetings appear next to the LPs they were with{g.calendar.details ? '' : ' (no descriptions: calendar.read.details adds them, to tell which raise a meeting was about)'}. Nothing is written to your calendar and no invitation is answered. {lastRead ? `Last read ${shortDate(new Date(lastRead.at))}${lastRead.status === 'running' ? ', reading now' : lastRead.status === 'failed' ? ', which stopped' : ''}.` : 'Not read yet.'} Read daily.</>
              : <span style={{ color: 'var(--amber)' }}>{CALENDAR[g.calendar?.state ?? 'unsupported']}</span>}</span></div>
            {g.calendar?.state === 'ok' && (
              <form action={readCalendarsAction} style={{ marginTop: 4 }}><button className="btn" type="submit">Read calendars now</button></form>
            )}
            {!g.canThread && <div className="fact"><span>Follow-ups</span><span style={{ color: 'var(--amber)' }}>start new threads: give the tool read.metadata in mailguard to reply in the thread.</span></div>}
            {g.extras.length > 0 && <div className="fact"><span>More than needed</span><span style={{ color: 'var(--amber)' }}>{g.extras.join(', ')} — drafting needs only draft and read.metadata. Narrow the tool in mailguard.</span></div>}
            <div className="fact"><span>Checked</span><span>{g.checkedAt ? shortDate(new Date(g.checkedAt)) : '—'} · again before every move, and daily</span></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 10 }}>
              <TestConnection />
              {g.source === 'pasted' && (
                <form action={forgetMailguardAction} style={{ marginTop: 8 }}>
                  <button className="btn" type="submit">Remove this token</button>
                </form>
              )}
            </div>
            {g.source === 'pasted' && <PasteToken label="Replace with another token" />}
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
              Forgetting removes the token from this Mac; it stays valid at mailguard until you revoke it there. Drafts
              already in Gmail stay there.{g.source === 'keychain' ? ' To use another token, paste it below; it takes the Keychain item’s place for you.' : ''}
            </p>
            {g.source === 'keychain' && <PasteToken label="Use this token instead" />}
          </>
        ) : g.connected ? (
          <>
            <p role="alert" style={{ marginTop: 0, color: g.transient ? 'var(--amber)' : 'var(--clay)' }}><b>{g.transient ? 'Could not check the token.' : 'Refused.'}</b> {g.reason}</p>
            <p>{g.transient
              ? 'Drafts wait until mailguard answers and says the token is drafts-only. Test the connection to ask again.'
              : `Email drafting is off for you until a drafts-only token is connected. Nothing was moved with this one.${g.mailbox ? ` (It is for ${g.mailbox}.)` : ''}`}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <TestConnection />
              {g.source === 'pasted' && (
                <form action={forgetMailguardAction} style={{ marginTop: 8 }}><button className="btn" type="submit">Forget this token</button></form>
              )}
            </div>
            {g.source === 'keychain' && <p className="muted" style={{ fontSize: 11.5 }}>It is the Keychain item plcos-claude / mailguard-token: replace it with <code>npm run secret:store -- mailguard-token</code> and restart, or paste a drafts-only token here.</p>}
            <PasteToken label="Connect a drafts-only token" />
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              Drafts written here go into your own Gmail Drafts through mailguard, where you review and send them yourself.
              In mailguard, create a tool whose policy grants <b>draft</b> and <b>read.metadata</b> (for follow-ups in their
              thread), and <b>calendar.read</b> if your meetings should appear next to LPs, and paste its token here. A token
              that can send, invite people or answer invitations is refused and not kept.
            </p>
            <PasteToken />
            {g.mode === 'fake' && (
              <form action={demoMailguardAction} style={{ marginTop: 10 }}>
                <button className="btn" type="submit">Use a demo token (drafts only)</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
