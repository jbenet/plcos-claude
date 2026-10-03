import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { draftsOn, gmailStatus, moveBlocks, PURPOSE_LABEL, warningsFor, type Draft } from '@/modules/email';
import { EmailDraftBox, type DraftView, type GmailView } from './EmailDraftBox';
import { NewDraftButton } from './NewDraftButton';
import s from './email.module.css';

/**
 * The email box on a page that suggests an email (docs/25 §Where boxes appear): the LP page's first
 * message and follow-ups, and a route's intro ask. Shows the signed-in person's own drafts here —
 * nobody else's — with the newest open, and a button to start one.
 */

export interface DraftsWhere { pursuitId?: string; entityId?: string; connectorId?: string; vehicleId?: string }

async function origin(): Promise<string> {
  const h = await headers();
  return `http://${h.get('host') ?? 'localhost'}`;
}

async function view(d: Draft): Promise<DraftView> {
  return {
    draftId: d.draftId, purposeLabel: PURPOSE_LABEL[d.purpose], revision: d.revision,
    to: d.to.join(', '), cc: d.cc.join(', '), bcc: d.bcc.join(', '), subject: d.subject, mode: d.mode, doc: d.doc, text: d.bodyText,
    attachments: d.attachments.map((a) => ({ attachmentId: a.attachmentId, filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes, inline: a.inline })),
    status: d.status, gmailAccount: d.gmailAccount, movedAt: d.movedAt?.toISOString() ?? null, movedRevision: d.movedRevision,
    prefillNote: d.status === 'editing' && d.revision === 1 ? d.prefill?.note ?? null : null,
    threaded: d.purpose === 'follow_up', warnings: await warningsFor(d), blocks: moveBlocks(d),
  };
}

export async function EmailDrafts({ title, lede, where, create, path, startLabel }: {
  title: string;
  lede: string;
  where: DraftsWhere;
  /** What a new draft is: purpose, vehicleId, and pursuitId or entityId/connectorId. */
  create: Record<string, string>;
  path: string;
  startLabel: string;
}) {
  const user = await (await auth()).currentUser();
  if (user.access === 'viewer') return null;
  const [drafts, g] = await Promise.all([draftsOn(user, where), gmailStatus(user, await origin())]);
  const gmail: GmailView = { mode: g.mode, email: g.email, why: g.why };
  const [open, ...rest] = drafts;
  const fields = { ...create, path };
  return (
    <div className="card" id="email">
      <div className="chead">
        <h2>{title}</h2>
        <span className="lbl">drafts go to your own Gmail · nothing sends from here</span>
      </div>
      {!open ? (
        <div className={s.start}>
          <p>{lede}</p>
          <NewDraftButton label={startLabel} fields={fields} />
        </div>
      ) : (
        <>
          <EmailDraftBox key={open.draftId} draft={await view(open)} gmail={gmail} path={path} />
          <div className={s.start} style={{ paddingTop: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {open.status === 'in_gmail' && (
              <NewDraftButton label="Write a follow-up in this thread" primary={false} fields={{ purpose: 'follow_up', vehicleId: open.vehicleId, replyToDraftId: open.draftId, path }} />
            )}
            <NewDraftButton label="Start another" primary={false} fields={fields} />
          </div>
        </>
      )}
      {rest.length > 0 && (
        <div className={s.list} aria-label="Earlier drafts">
          {await Promise.all(rest.map(async (d) => (
            <details key={d.draftId} className={s.earlier}>
              <summary className={s.row}>
                <span className="lbl">{PURPOSE_LABEL[d.purpose]}</span>
                <span>{d.subject || <i className="muted">no subject</i>}</span>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
                  {d.status === 'in_gmail' && d.movedAt ? `in Gmail since ${shortDate(d.movedAt)}` : `edited ${shortDate(d.updatedAt)}`}
                </span>
              </summary>
              <EmailDraftBox key={d.draftId} draft={await view(d)} gmail={gmail} path={path} />
              {d.status === 'in_gmail' && (
                <div className={s.start} style={{ paddingTop: 0 }}>
                  <NewDraftButton label="Write a follow-up in this thread" primary={false} fields={{ purpose: 'follow_up', vehicleId: d.vehicleId, replyToDraftId: d.draftId, path }} />
                </div>
              )}
            </details>
          )))}
        </div>
      )}
      <p className="cover">
        <b>A draft is not a send.</b> Moving puts it in your Gmail Drafts to review and send yourself. The checks above
        the button read the restrictions, the vehicle&rsquo;s wrap rule and, for an intro ask, its approval; they warn and
        never block, and every move is recorded.
      </p>
    </div>
  );
}
