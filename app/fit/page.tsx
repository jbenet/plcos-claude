import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { Meter } from '@/components/fit/marks';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { listAssessments, BLOCKER_LABEL, type Assessment, type Blocker } from '@/modules/fit';

export const dynamic = 'force-dynamic';

const BLOCKER_FLAG: Record<Blocker, string> = {
  gated: 'f-block', conviction: 'f-ev', access: 'f-ev', evidence: 'f-ev',
  fit: 'f-ev', timing: 'f-mute', awareness: 'f-mute', none: 'f-ok',
};

const BAND_FLAG: Record<Assessment['band'], string> = {
  strong: 'f-ok', workable: 'f-ev', weak: 'f-mute', blocked: 'f-block',
};

/**
 * What each blocker means for the week, in the language of work rather than of state.
 * This is the part that turns a list into a plan: five awareness gaps and five conviction
 * gaps are the same pipeline shape and completely different jobs.
 */
const WORK: Record<Blocker, string> = {
  gated: 'Correct the record or drop them. No amount of relationship work moves a gate.',
  conviction: 'Answer a specific objection with evidence. More reach makes this worse, not better.',
  access: 'Find a connector with credibility on this topic. Nothing else can start.',
  evidence: 'Go and get one fact. These are cheap and nobody has done them.',
  fit: 'Stop. Time here is time not spent on a firm that could say yes.',
  timing: 'Diarise a return. Keep it warm; do not spend an ask now.',
  awareness: 'Prime before asking. Material through the connector ahead of the introduction.',
  none: 'Ask. The constraint is calendar, not qualification.',
};

const ORDER: Blocker[] = ['none', 'awareness', 'conviction', 'evidence', 'access', 'timing', 'fit', 'gated'];

export default async function FitRollup() {
  const selection = await vehicleSelection();
  const rows = await listAssessments(selection.current?.id ?? null);

  const byBlocker = ORDER
    .map((b) => ({ blocker: b, rows: rows.filter((r) => r.diagnosis.blocker === b) }))
    .filter((g) => g.rows.length > 0);

  const clear = rows.filter((r) => r.gateStatus === 'clear').length;
  const cover = rows.length
    ? rows.reduce((s, r) => s + r.evidenceCover, 0) / rows.length
    : 0;
  const reachable = rows.filter((r) => r.diagnosis.blocker !== 'gated' && r.diagnosis.blocker !== 'fit').length;

  return (
    <Page
      crumbs={[
        { label: selection.current ? selection.current.name : 'All vehicles' },
        { label: 'Funder–vehicle fit' },
      ]}
      inspector={
        <>
          <div className="lbl">The shape of it</div>
          <div className="ihead">
            {rows.length} assessment{rows.length === 1 ? '' : 's'}
          </div>
          <div className="imeta">
            {selection.current ? selection.current.name : 'every vehicle, listed separately'}
          </div>
          {byBlocker.map((g) => (
            <div className="kv" key={g.blocker}>
              <span>{BLOCKER_LABEL[g.blocker]}</span>
              <span>{g.rows.length}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Read this as a work queue</div>
            <p>
              The counts above are not a funnel. Each one is a different job: an awareness gap
              needs reach, a conviction gap needs one objection answered, an unanswered gate needs
              somebody to pick up the phone. Counting them together produces the number that makes
              a fundraise feel busy and go nowhere.
            </p>
          </div>
          <div className="note">
            Assessments are per firm <i>and</i> per vehicle. The same firm appears more than once
            with different readings, and nothing here is summed across vehicles.
          </div>
        </>
      }
    >
      <div className="lbl">
        Funder–vehicle fit · {selection.current ? selection.current.name : 'all vehicles'}
      </div>
      <h1>Where we stand with each funder</h1>
      <p className="sublede">
        One firm against one vehicle: the gates that decide whether they can participate at all,
        the dimensions that decide whether they should want to, what they think of us, and who we
        know in common. Every reading carries whether it is known, inferred or guessed — the
        difference is the point, not a footnote.
      </p>

      <div className="kpis">
        <div className="kpi">
          <div className="n">{rows.length}</div>
          <div className="f">assessed, firm × vehicle</div>
        </div>
        <div className="kpi">
          <div className={`n${clear === rows.length ? ' g' : ''}`}>{clear}</div>
          <div className="f">with every gate answered and passing</div>
        </div>
        <div className="kpi">
          <div className="n">{reachable}</div>
          <div className="f">where the work is ours to do</div>
        </div>
        <div className="kpi soft">
          <div className="n q">{Math.round(cover * 100)}%</div>
          <div className="f">of the weight rests on things we know</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing assessed</span>
              <h3>No funder has been assessed against this vehicle.</h3>
              <p>
                An empty list here means nobody has done the work. It is not a finding about the
                LP universe, and it should not be read as one.
              </p>
            </div>
          </div>
        </div>
      ) : (
        byBlocker.map((g) => (
          <div className="card" key={g.blocker}>
            <div className="chead">
              <h2>
                <span className={`flag ${BLOCKER_FLAG[g.blocker]}`} style={{ marginRight: 8 }}>
                  {g.rows.length}
                </span>
                {BLOCKER_LABEL[g.blocker]}
              </h2>
            </div>
            <div className="worknote">{WORK[g.blocker]}</div>
            {g.rows.map((r) => (
              <div className="row" key={r.assessmentId} style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 66, flex: 'none', textAlign: 'center', marginTop: 2 }}>
                  <div className="mono" style={{ fontSize: 17, fontWeight: 500 }}>
                    {r.weightedFit.toFixed(2)}
                  </div>
                  <span className={`flag ${BAND_FLAG[r.band]}`} style={{ fontSize: 9.5, marginTop: 4, display: 'inline-block' }}>
                    {r.band}
                  </span>
                </div>
                <div className="t">
                  <Link href={`/fit/${r.entityId}`}><b>{r.entityName}</b></Link>
                  {!selection.current && (
                    <span className="flag f-mute" style={{ marginLeft: 8 }}>{r.vehicleName}</span>
                  )}
                  <span style={{ display: 'block', marginTop: 2 }}>{r.diagnosis.statement}</span>
                  <div className="muted" style={{ marginTop: 6, fontSize: 11.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      known <Meter value={r.evidenceCover} /> {Math.round(r.evidenceCover * 100)}%
                    </span>
                    <span>{r.strongCount}/{r.gradedCount} dimensions good or better</span>
                    <span>
                      gates {r.gates.filter((x) => x.passed === true).length}/{r.gates.length}
                      {r.unknownGates.length > 0 ? ` · ${r.unknownGates.length} open` : ''}
                      {r.failedGates.length > 0 ? ` · ${r.failedGates.length} failing` : ''}
                    </span>
                    <span>{r.ownerName ?? 'unassigned'} · {shortDate(r.updatedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <p className="cover">
        <b>What this covers:</b> {rows.length} assessment{rows.length === 1 ? '' : 's'} recorded in
        this system{selection.current ? ` against ${selection.current.name}` : ' across every vehicle'}
        . Firms nobody has assessed do not appear — that is a gap in our work, not a judgement
        about them, and the two should never be read as the same thing.
      </p>
    </Page>
  );
}
