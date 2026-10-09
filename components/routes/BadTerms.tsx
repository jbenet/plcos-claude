import { AuthorizedControl } from '@/lib/authz/read/Control';
import { markBadTermsAction, undoBadTermsAction } from '@/app/routes/actions';
import type { BadTermsMark } from '@/lib/authz/read/network';

/**
 * Issue 0143: warmth says how close two people are, not whether they get on. Marking a pair on bad terms
 * excludes every route that would ask one of them about the other, and says why; undoing it restores them.
 */
export function MarkBadTerms({ people, a, b }: { people: Array<{ id: string; name: string }>; a?: string; b?: string }) {
  const unique = [...new Map(people.map((p) => [p.id, p])).values()];
  if (unique.length < 2) return null;
  return <AuthorizedControl action="mutate">
    <details className="bad-terms">
      <summary>Two people here on bad terms?</summary>
      <form action={markBadTermsAction} className="bad-terms-form">
        <label>Who <select name="a" defaultValue={a ?? unique.at(-2)!.id}>{unique.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>and <select name="b" defaultValue={b ?? unique.at(-1)!.id}>{unique.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Why, briefly (optional) <input name="note" maxLength={500} placeholder="For example: they fell out over a deal" /></label>
        <button className="btn">Mark on bad terms</button>
        <p className="muted">Every route that asks one of them about the other is then excluded, with this reason. You can undo it.</p>
      </form>
    </details>
  </AuthorizedControl>;
}

export function UndoBadTerms({ markId, label = 'Undo the bad-terms mark' }: { markId: string; label?: string }) {
  return <AuthorizedControl action="mutate">
    <form action={undoBadTermsAction} style={{ display: 'inline' }}>
      <input type="hidden" name="markId" value={markId} />
      <button className="btn">{label}</button>
    </form>
  </AuthorizedControl>;
}

export function BadTermsList({ marks }: { marks: BadTermsMark[] }) {
  if (!marks.length) return null;
  return <details className="card route-aux" open>
    <summary>On bad terms · {marks.length}</summary>
    <div className="cbody">
      {marks.map((m) => <div key={m.markId} className="bad-terms-row">
        <b>{m.aName}</b> and <b>{m.bName}</b>
        <span className="muted"> · marked by {m.byName}, {m.at.toISOString().slice(0, 10)}{m.note ? ` · ${m.note}` : ''} </span>
        <UndoBadTerms markId={m.markId} label="Undo" />
      </div>)}
      <p className="muted" style={{ fontSize: 12 }}>Routes that ask one of these people about the other are excluded.</p>
    </div>
  </details>;
}
