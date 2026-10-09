import { AuthorizedControl } from '@/lib/authz/read/Control';
import { recordOwnTieAction, removeOwnTieAction } from '@/app/routes/actions';
import { OWN_TIE_KINDS, type OwnTie as Tie } from '@/lib/authz/read/network';

/**
 * Issue 0144: your own tie to this person, said by you. A shared organisation is not a personal tie, so a
 * tie the graph cannot see (former partners at one firm, say) is recorded here and routes from now on.
 */
export function OwnTie({ targetId, targetName, ties }: { targetId: string; targetName: string; ties: Tie[] }) {
  return <AuthorizedControl action="mutate">
    <div className="cbody own-tie">
      <h3>Your own tie to {targetName}</h3>
      {ties.map((t) => <p key={t.edgeId}>
        <b>{t.note}</b> <span className="muted">· grade {t.tier} · recorded {t.at.toISOString().slice(0, 10)} </span>
        <form action={removeOwnTieAction} style={{ display: 'inline' }}>
          <input type="hidden" name="edgeId" value={t.edgeId} /><input type="hidden" name="target" value={targetId} />
          <button className="btn">Remove</button>
        </form>
      </p>)}
      <form action={recordOwnTieAction} className="bad-terms-form">
        <input type="hidden" name="target" value={targetId} />
        <label>How you know them <select name="kind" defaultValue="worked_together">
          {Object.entries(OWN_TIE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select></label>
        <label>Where or how (optional) <input name="note" maxLength={300} placeholder="For example: former partners at the same firm" /></label>
        <label>Last in touch (optional) <input name="last" type="date" /></label>
        <button className="btn p">Record my tie</button>
        <p className="muted">Recorded as yours, confirmed by you, and used by routes from now on. Rebuilding the network keeps it; remove it here.</p>
      </form>
    </div>
  </AuthorizedControl>;
}
