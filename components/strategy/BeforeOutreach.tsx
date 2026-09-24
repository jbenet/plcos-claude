import { notesFor } from '@/modules/research';
import type { Triage } from '@/lib/enrich/triage';

/**
 * The check our records point to before anyone writes to this LP (W9, iteration 3, docs/19): name
 * an owner, check sent mail, or a first personal note rather than a follow-up. Mapped in by the
 * enrichment import from triage.jsonl; it reads our own records only, and it sends nothing.
 */
const FIRST: Record<NonNullable<Triage['first']>, { title: string; means: string; match: RegExp }> = {
  'name an owner': {
    title: 'Name an owner',
    means: 'There is a way in, and nobody on the team owns the pursuit. Whoever holds the relationship takes it first.',
    match: /owns the pursuit|close contact|colleague|inside the Protocol Labs/i,
  },
  'check sent mail': {
    title: 'Check sent mail',
    means: 'The stage on file claims contact that no touch on record shows. Check what was sent before writing, so we never cross a note we can’t see.',
    match: /stage on file/i,
  },
  'first personal note': {
    title: 'A first personal note',
    means: 'Our last word was a mailing, sent the same day to many others. They have had no personal note yet; the next one is a first, not a follow-up.',
    match: /mailing/i,
  },
};

export async function BeforeOutreach({ entityId }: { entityId: string }) {
  const note = (await notesFor(entityId)).find((n) => n.kind === 'triage');
  const t = note?.data as unknown as Triage | undefined;
  if (!t?.first) return null;
  const f = FIRST[t.first];
  const why = t.reasons.filter((r) => f.match.test(r));
  return (
    <div className="card">
      <div className="chead">
        <h2>Before any outreach</h2>
        <span className="lbl">from our records · {t.lane}</span>
      </div>
      <div className="cbody">
        <p style={{ margin: 0 }}><b>{f.title}.</b> {f.means}</p>
        {why.length > 0 && <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>{why.join(' · ')}</p>}
      </div>
      <p className="cover">
        <b>What this reads:</b> the pipeline, the touches on record and our notes — nothing public,
        and nothing sent. It is a check for a person, and a person can overrule it.
      </p>
    </div>
  );
}
