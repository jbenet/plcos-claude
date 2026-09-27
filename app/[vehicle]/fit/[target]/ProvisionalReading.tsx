import Link from '@/components/ui/AppLink';
import { Page, type Crumb } from '@/components/shell/Page';
import { shortDate } from '@/lib/time';
import { capacityBandLabel } from '@/lib/capacity-bands';
import type { vehicleReadings } from '@/lib/vehicle-readings';
import { STATUS_LABEL } from '@/modules/strategy';
import s from './reading.module.css';

type Reading = Awaited<ReturnType<typeof vehicleReadings>>[number];

const VERDICT: Record<string, { label: string; flag: string }> = {
  strong: { label: 'Strong fit', flag: 'f-ok' }, good: { label: 'Good fit', flag: 'f-ok' },
  possible: { label: 'Possible fit', flag: 'f-ev' }, weak: { label: 'Weak fit', flag: 'f-mute' },
  unknown: { label: 'Fit not known', flag: 'f-mute' },
};
const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Not known' };
const ANSWER: Record<string, { label: string; flag: string }> = {
  yes: { label: 'Passes', flag: 'f-ok' }, no: { label: 'Fails', flag: 'f-block' }, unknown: { label: 'Unanswered', flag: 'f-ev' },
};

/**
 * One LP against one vehicle when nobody has done a formal assessment (issue 0073): the latest
 * strategy's reading for this pursuit on this vehicle, marked provisional throughout. It never
 * borrows another vehicle's reading, and a score here clears no gate.
 */
export function ProvisionalReading({ reading: r, crumbs }: { reading: Reading; crumbs: Crumb[] }) {
  const st = r.data!;
  const sc = st.scores;
  const v = VERDICT[r.fit?.verdict ?? 'unknown'] ?? VERDICT.unknown!;
  const gates = r.fit?.gates ?? [];
  const failing = gates.some((g) => g.answer === 'no');
  return (
    <Page
      crumbs={crumbs}
      inspector={
        <>
          <div className="lbl">Where we stand</div>
          <div className="ihead">{r.entity_name}</div>
          <div className="imeta">{r.vehicle_name} · owner {r.owner_name}</div>
          <div className="kv"><span>Status</span><span>{STATUS_LABEL[r.status]}</span></div>
          <div className="kv"><span>Reading</span><span><span className={`flag ${failing ? 'f-block' : v.flag}`}>{failing ? 'Fails a gate' : v.label}</span></span></div>
          <div className="kv"><span>Provisional score</span><span className="mono">{r.score ?? '—'}{r.score !== null && ' / 100'}</span></div>
          <div className="kv"><span>Written</span><span>{r.made_at ? shortDate(r.made_at) : 'undated'}</span></div>
          <div className="kv"><span>Confidence</span><span>{st.confidence ?? 'not stated'}</span></div>
          <div className="scope">
            <div className="lbl">Provisional, not assessed</div>
            <p>
              A strategy’s reading of this LP, written from public sources and our records. Nobody has answered the gates
              and graded the dimensions yet; when someone does, the formal assessment replaces this page.
            </p>
          </div>
        </>
      }
    >
      <div className="lbl">Funder–vehicle fit · {r.vehicle_name} · provisional</div>
      <h1>{r.entity_name}</h1>
      <p className="sublede">
        {st.angle ?? 'The reading gives no angle.'}
      </p>

      <div className={s.verdict}>
        <div className={s.score}>
          <span className="lbl">Score</span>
          <b className="mono">{r.score ?? '—'}</b>
          <small>{r.score === null ? 'fewer than two readings known' : 'provisional · of 100'}</small>
        </div>
        <div className={s.what}>
          <span className={`flag ${failing ? 'f-block' : v.flag}`}>{failing ? 'Fails a gate' : v.label}</span>
          <p>{r.fit?.why ?? 'The strategy names no reason for its verdict on this vehicle.'}</p>
          <div className={s.links}>
            <Link className="btn" href={`/${r.vehicle_slug}/pipeline/${r.pursuit_id}`}>LP workspace →</Link>
            <Link className="xref" href={`/${r.vehicle_slug}/strategy/${r.entity_id}`}>strategy and sources →</Link>
          </div>
        </div>
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead"><h2>Can they take part</h2><span className="lbl">{gates.length} gate{gates.length === 1 ? '' : 's'}</span></div>
          {gates.length === 0 ? <div className="cbody"><p className="muted">The reading names no gates. Participation is unanswered, not cleared.</p></div>
            : gates.map((g, i) => (
              <div className="row" key={i} style={{ alignItems: 'flex-start' }}>
                <div className="t"><b>{g.gate}</b><span>{g.basis}</span></div>
                <span className={`flag ${ANSWER[g.answer]?.flag ?? 'f-ev'}`}>{ANSWER[g.answer]?.label ?? g.answer}</span>
              </div>
            ))}
        </div>

        <div className="card">
          <div className="chead"><h2>The four readings</h2><span className="lbl">weighted into the score</span></div>
          {([
            ['Capacity', sc?.capacity?.band && sc.capacity.band !== 'unknown' ? capacityBandLabel(sc.capacity.band) : 'Not known', sc?.capacity?.basis],
            ['Affinity', LEVEL[sc?.affinity?.level ?? 'unknown'], sc?.affinity?.basis],
            ['Propensity', LEVEL[sc?.propensity?.level ?? 'unknown'], sc?.propensity?.basis],
            ['Time to decide', sc?.timeToDecision?.band && sc.timeToDecision.band !== 'unknown' ? sc.timeToDecision.band : 'Not known', sc?.timeToDecision?.basis],
          ] as Array<[string, string, string | undefined]>).map(([label, value, basis]) => (
            <div className={s.reading} key={label}>
              <span>{label}</span>
              <b>{value}</b>
              <p>{basis || 'No basis given.'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="chead"><h2>What the strategy proposes</h2><span className="lbl">{r.made_by ?? 'unattributed'} · {r.made_at ? shortDate(r.made_at) : 'undated'}</span></div>
        <div className="cbody">
          {st.next && <div className="fact"><span>Next</span><span>{st.next.what}{st.next.who ? ` — ${st.next.who}` : ''}{st.next.when ? `, ${st.next.when}` : ''}</span></div>}
          {st.route && <div className="fact"><span>Way in</span><span>{st.route.via} <span className="muted">— tier {st.route.tier}</span></span></div>}
          {st.ask && <div className="fact"><span>The ask</span><span>{st.ask.shape}{st.ask.range ? ` · ${st.ask.range}` : ''}</span></div>}
          {st.openQuestions?.length ? <div className="fact"><span>To find out</span><span>{st.openQuestions.join(' · ')}</span></div> : null}
          {st.risks?.map((x, i) => <p className="warnline" key={i} style={{ margin: '8px 0 0', fontSize: 12 }}>{x}</p>)}
        </div>
        <p className="cover">
          <b>Proposed, not decided.</b> Accepting it in the LP workspace makes the next action the pursuit’s next step; the
          status, the ladder and the money do not move, and nothing is sent.
        </p>
      </div>
    </Page>
  );
}
