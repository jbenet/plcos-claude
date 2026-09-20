import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { WeightsForm } from '@/components/scoring/WeightsForm';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { listSourceDocs } from '@/modules/research';
import {
  activeWeights, BAND_LABEL, DIMENSION_LABEL, DIMENSION_MEANS, DIMENSIONS, listWeights, ranked,
} from '@/modules/scoring';

export const dynamic = 'force-dynamic';

const BAND_FLAG: Record<string, string> = {
  strong: 'f-ok', worth_a_look: 'f-ev', weak: 'f-mute', unscored: 'f-mute',
};

export default async function Selection() {
  const selection = await vehicleSelection();
  const vehicle = selection.current ?? selection.all.find((v) => v.slug === 'neurotech') ?? selection.all[0];
  const [weights, history, docs] = await Promise.all([activeWeights(), listWeights(), listSourceDocs()]);
  const rows = vehicle ? await ranked(vehicle.id) : [];
  const scored = rows.filter((r) => r.score !== null);
  const unscored = rows.filter((r) => r.score === null);

  const docMap = new Map<string, EvidenceDoc>(
    docs.map((d) => [
      d.docId,
      { docId: d.docId, title: d.title, origin: d.origin, asOf: shortDate(d.asOf), strength: d.strength, supports: d.supports },
    ]),
  );

  return (
    <Page
      crumbs={[{ label: 'Discover & qualify' }, { label: 'Selection' }]}
      inspector={
        weights ? (
          <>
            <div className="lbl">Weights</div>
            <div className="ihead">The argument, in the open</div>
            <div className="imeta">
              {weights.label} · {weights.createdByName ?? 'system'} · {shortDate(weights.createdAt)}
            </div>
            <WeightsForm weights={weights} />
            {history.length > 1 && (
              <>
                <div className="lbl" style={{ marginTop: 14 }}>
                  Previous sets
                </div>
                {history.slice(1, 5).map((w) => (
                  <div className="prov" key={w.weightsId}>
                    <div className="p1">{w.label}</div>
                    <div className="p2">
                      {Math.round(w.capacity * 100)}/{Math.round(w.affinity * 100)}/
                      {Math.round(w.propensity * 100)}/{Math.round(w.timeToDecision * 100)} ·{' '}
                      {shortDate(w.createdAt)}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        ) : (
          <p className="muted">No active weight set.</p>
        )
      }
    >
      <div className="lbl">Module 03 · Discover &amp; qualify</div>
      <h1>Selection</h1>
      <p className="sublede">
        A rubric, not a model. Four dimensions, weights you can see and change, and a sentence
        under every number saying where it came from. Nothing here is learned and nothing is
        inferred — if a factor is missing, the target is reported as unscored rather than scored on
        the half we happen to have.
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Nothing scored
              </span>
              <h3>No factors have been recorded for {vehicle?.name ?? 'this vehicle'}.</h3>
              <p>
                The rubric only ranks what someone has assessed. An empty list here means nobody has
                done the work, not that nobody qualifies.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="chead">
              <h2>Ranked — {vehicle?.name}</h2>
              <span className="lbl">
                {scored.length} scored · {unscored.length} unscored ·{' '}
                {weights
                  ? `${Math.round(weights.capacity * 100)}/${Math.round(weights.affinity * 100)}/${Math.round(weights.propensity * 100)}/${Math.round(weights.timeToDecision * 100)}`
                  : 'no weights'}
              </span>
            </div>
            {rows.map((r) => (
              <div className="row" key={r.entityId} style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 62, flex: 'none', textAlign: 'center', marginTop: 2 }}>
                  <div className="mono" style={{ fontSize: 17, fontWeight: 500 }}>
                    {r.score === null ? '—' : r.score.toFixed(2)}
                  </div>
                  <span className={`flag ${BAND_FLAG[r.band]}`} style={{ fontSize: 9.5, marginTop: 4, display: 'inline-block' }}>
                    {r.band === 'unscored' ? 'unscored' : r.band.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="t">
                  <Link href={`/research/${r.entityId}`}>
                    <b>{r.entityName}</b>
                  </Link>
                  <Link className="xref" href={`/fit/${r.entityId}`}>
                    fit &amp; standing →
                  </Link>
                  {r.missing.length > 0 ? (
                    <span style={{ color: 'var(--clay)', display: 'block', marginTop: 2 }}>
                      {BAND_LABEL.unscored}: {r.missing.map((d) => DIMENSION_LABEL[d]).join(' and ')}{' '}
                      {r.missing.length === 1 ? 'has' : 'have'} no factor on file. Three quarters of
                      a rubric is not a score.
                    </span>
                  ) : (
                    <span style={{ display: 'block', marginTop: 2 }}>
                      Leading dimension: {r.leading ? DIMENSION_LABEL[r.leading] : '—'}.
                    </span>
                  )}
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {DIMENSIONS.map((d) => {
                      const f = r.factors.find((x) => x.dimension === d);
                      return (
                        <div key={d} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span
                            className="mono"
                            style={{ width: 118, flex: 'none', fontSize: 10.5, color: 'var(--muted)' }}
                          >
                            {DIMENSION_LABEL[d]}
                          </span>
                          <span style={{ width: 92, flex: 'none' }}>
                            <span
                              style={{
                                display: 'block', height: 6, borderRadius: 3,
                                background: '#EDEAE2', position: 'relative', marginTop: 5,
                              }}
                            >
                              {f && (
                                <span
                                  style={{
                                    position: 'absolute', left: 0, top: 0, bottom: 0,
                                    width: `${f.value * 100}%`, borderRadius: 3,
                                    background: f.value >= 0.7 ? 'var(--green)' : f.value >= 0.45 ? 'var(--amber)' : '#B8B2A6',
                                  }}
                                />
                              )}
                            </span>
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.45, flex: 1 }}>
                            {f ? (
                              <>
                                {f.basis}
                                {f.source && docMap.has(f.source) && <EvidenceRef doc={docMap.get(f.source)!} />}
                                <span className="mono" style={{ fontSize: 10, marginLeft: 6 }}>
                                  {shortDate(f.asOf)} · {f.recordedByName}
                                </span>
                              </>
                            ) : (
                              <i>No factor recorded.</i>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            <p className="cover">
              <b>What the number is:</b> Σ weight × factor, over four factors a person wrote down
              with a reason each. It is a way of arguing about an order, not a probability of
              anything. The band cut-offs (0.70 and 0.45) are judgement and should move once there
              are outcomes to fit them against.
            </p>
          </div>

          <div className="card">
            <div className="chead">
              <h2>What each dimension is asking</h2>
            </div>
            <div className="cbody">
              {DIMENSIONS.map((d) => (
                <div className="fact" key={d}>
                  <span>{DIMENSION_LABEL[d]}</span>
                  <span style={{ fontWeight: 400, textAlign: 'right', maxWidth: '68%' }}>
                    {DIMENSION_MEANS[d]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
