import Link from '@/components/ui/AppLink';
import { getDb } from '@/lib/db';
import { shortDate } from '@/lib/time';
import {
  SPV_BASIS_LABEL, SPV_KIND_LABEL, spvHistory, spvReadings, spvWords, type SpvEvidence, type SpvReading,
} from '@/modules/strategy';
import { SpvControl } from './SpvControl';
import s from './spv.module.css';

/**
 * SPV stance (Juan, 27 Sep 2026): on the LP page, what we know about whether this LP does SPVs — the
 * stance, every piece of evidence with its provenance (rule 9), any conflict — and a person's control
 * to set it, which always wins and can be withdrawn.
 */
export async function SpvCard({ entityId, entityName, spvVehicle }: { entityId: string; entityName: string; spvVehicle: boolean }) {
  const db = await getDb();
  const [readings, history] = await Promise.all([spvReadings(db, [entityId]), spvHistory(db, entityId)]);
  const r = readings.get(entityId)!;
  const setting = r.evidence.find((e) => e.kind === 'person') ?? null;
  return (
    <div className="card" style={spvVehicle && r.stance === 'does-not' ? { boxShadow: 'inset 3px 0 0 var(--clay)' } : undefined}>
      <div className="chead">
        <h2>SPVs</h2>
        <span className="lbl">{SPV_BASIS_LABEL[r.basis]}</span>
      </div>
      <div className="cbody">
        <div className={s.now}>
          <strong className={r.stance === 'does' ? s.does : r.stance === 'does-not' ? s.not : undefined}>{spvWords(r)}</strong>
        </div>
        <p className={s.lead}>
          {lede(r, entityName)}
          {spvVehicle && r.stance === 'does-not' && <> <b className={s.not}>This pursuit is for an SPV.</b> Settle whether they would take part before any approach.</>}
        </p>
        {r.evidence.length > 0 && <ul className={s.evidence} aria-label="Evidence on file">
          {r.evidence.map((e, i) => <Evidence key={i} e={e} r={r} />)}
        </ul>}
        <SpvControl entityId={entityId} current={setting ? { stance: setting.stance, minDeals: setting.minDeals, note: setting.quote } : null} />
        {history.length > 0 && <details className={s.history}>
          <summary>{history.length} {history.length === 1 ? 'setting' : 'settings'} on record</summary>
          <ul>{history.map((h) => <li key={h.id}>
            {shortDate(new Date(h.at))} · {h.by ?? 'someone'} set <b>{spvWords(h)}</b>{h.note ? <> · “{h.note}”</> : null}
            <span className="muted">{h.ended === 'replaced' ? ' · replaced' : h.ended === 'withdrawn' ? ` · withdrawn${h.endedBy ? ` by ${h.endedBy}` : ''}${h.endedAt ? ` ${shortDate(new Date(h.endedAt))}` : ''}` : ' · standing'}</span>
          </li>)}</ul>
        </details>}
      </div>
    </div>
  );
}

function lede(r: SpvReading, name: string) {
  if (r.basis === 'none') return <>Nothing on file says whether {name} does SPVs, so they are read as likely open. Research, Dakota and our own SPVs are checked by Derive SPV stance.</>;
  if (r.basis === 'person') return <>A person’s setting. It stands over what the evidence says{r.conflict ? ', which disagrees' : ''} until it is withdrawn.</>;
  const w = r.winner!;
  return <>{r.basis === 'research' ? 'From research' : 'Derived from our records'}: {w.label.replace(/^Research: /, '')}.{' '}
    {r.conflict ? <>Other evidence disagrees: {lower(r.conflict.label)}. The stronger wins, and both are listed.</> : null}</>;
}

function Evidence({ e, r }: { e: SpvEvidence; r: SpvReading }) {
  const won = e === r.winner, lost = r.conflict && e.stance !== r.stance && e.stance !== 'unknown';
  return (
    <li>
      <div className={s.evTop}>
        <span><b>{e.kind === 'person' ? `${SPV_KIND_LABEL.person}: ${spvWords(e)}` : e.label}</b></span>
        {won ? <span className={s.won}>stands</span> : lost ? <span className={s.lost}>disagrees</span> : null}
      </div>
      {e.quote && <span className={s.quote}>“{e.quote}”</span>}
      <span className={s.prov}>
        {e.kind === 'person' ? 'LP page' : e.kind === 'dakota' ? 'Dakota, a vendor’s claim (tier C)' : e.kind === 'pipeline' ? 'Our commitments and statuses'
          : e.url ? <a href={e.url} target="_blank" rel="noreferrer noopener">{hostOf(e.url)}</a> : e.source}
        {' '}· as of {e.asOf} · confidence {e.confidence} · {e.kind === 'person' ? `set by ${e.lastVerifiedBy ?? 'someone'}` : e.kind === 'dakota' ? `imported by ${e.lastVerifiedBy ?? 'the Dakota job'}, not verified` : e.lastVerifiedBy ? `verified by ${e.lastVerifiedBy}` : 'nobody has verified it'}
      </span>
    </li>
  );
}

const lower = (t: string) => (/^(The|A) /.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The note in a strategy detail when the vehicle is an SPV: what we know, before the approach. */
export async function SpvNote({ entityId, entityName, lpHref }: { entityId: string; entityName: string; lpHref: string | null }) {
  const r = (await spvReadings(await getDb(), [entityId])).get(entityId)!;
  const flagged = r.stance === 'does-not';
  return (
    <div className="card" style={flagged ? { boxShadow: 'inset 3px 0 0 var(--clay)' } : undefined}>
      <div className="chead"><h2>Approaching for an SPV</h2><span className="lbl">{SPV_BASIS_LABEL[r.basis]}</span></div>
      <div className={`cbody ${s.note}`}>
        <strong className={r.stance === 'does' ? s.does : flagged ? s.not : undefined}>{spvWords(r)}</strong>
        <p>
          {r.stance === 'does' ? <>{entityName} has done SPV or co-investment deals{r.minDeals ? `, at least ${r.minDeals} known` : ''}: an SPV ask fits how they invest. </>
            : flagged ? <>{entityName} is on record as not doing SPVs. An SPV ask likely fails: check the evidence, or ask about the fund instead. </>
            : <>Nothing on file either way, so read as likely open. Their answer is worth recording once known. </>}
          {r.winner && <span className="muted">{r.winner.kind === 'person' ? `Set by ${r.winner.lastVerifiedBy ?? 'a person'} ${r.winner.asOf}` : `${r.winner.label}, ${r.winner.asOf}`}{r.winner.quote ? `: “${r.winner.quote.replace(/[.!?]+$/, '')}”` : ''}.{r.conflict ? ` Other evidence disagrees (${r.conflict.label}).` : ''} </span>}
          {lpHref && <Link href={lpHref}>Evidence and setting on the LP page →</Link>}
        </p>
      </div>
    </div>
  );
}
