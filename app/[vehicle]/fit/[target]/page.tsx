import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { CertaintyMark, Reading, Meter, certaintyMeans } from '@/components/fit/marks';
import { FitDimensions, type DimRow } from '@/components/fit/FitDimensions';
import { ScoreStrip, standingFor } from '@/components/fit/Score';
import { usdM } from '@/lib/money';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { getEntity } from '@/modules/identity';
import { listSourceDocs } from '@/modules/research';
import {
  assessmentFor, assessmentsForEntity, contributions, listAssessments,
  BLOCKER_LABEL, CERTAINTY_LABEL, DECISION_LABEL, FAMILIARITY_LABEL, FIRM_CLASS_LABEL,
  GRADE_LABEL, GRADE_SIGN, LINK_LABEL, SENTIMENT_LABEL,
  type Assessment, type Blocker, type Familiarity, type Sentiment,
} from '@/modules/fit';

export const dynamic = 'force-dynamic';

const BLOCKER_FLAG: Record<Blocker, string> = {
  gated: 'f-block', conviction: 'f-ev', access: 'f-ev', evidence: 'f-ev',
  fit: 'f-ev', timing: 'f-mute', awareness: 'f-mute', none: 'f-ok',
};

const BAND_FLAG: Record<Assessment['band'], string> = {
  strong: 'f-ok', workable: 'f-ev', weak: 'f-mute', blocked: 'f-block',
};

const FAM_RANK: Record<Familiarity, number> = { unaware: 0, heard_of: 1, familiar: 2, deep: 3 };
const SENT_RANK: Record<Sentiment, number> = {
  negative: 0, skeptical: 1, unknown: 2, neutral: 2, positive: 3, champion: 4,
};
const SENT_FLAG: Record<Sentiment, string> = {
  negative: 'f-block', skeptical: 'f-ev', neutral: 'f-mute', unknown: 'f-mute',
  positive: 'f-ok', champion: 'f-ok',
};

const SUBJECT_ORDER = ['firm', 'vehicle', 'thesis', 'person', 'portfolio'];

const gateMark = (passed: boolean | null) =>
  passed === true ? <span className="flag f-ok">Passes</span>
  : passed === false ? <span className="flag f-block">Fails</span>
  : <span className="flag f-ev">Unanswered</span>;

export default async function FunderVehicleFit({
  params,
}: {
  params: Promise<{ vehicle: string; target: string }>;
}) {
  const { vehicle: slug, target: entityId } = await params;
  const [entity, selection, docs] = await Promise.all([
    getEntity(entityId), vehicleSelection(), listSourceDocs(),
  ]);
  if (!entity) notFound();
  const vehicle = slug === 'all' ? null : selection.all.find((v) => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();

  const all = await assessmentsForEntity(entityId);
  const a = vehicle ? await assessmentFor(entityId, vehicle.id) : null;
  const pool = a ? await listAssessments(a.vehicleId) : [];
  const standing = a ? standingFor(a, pool) : null;

  const docMap: Record<string, EvidenceDoc> = Object.fromEntries(
    docs.map((d) => [
      d.docId,
      { docId: d.docId, title: d.title, origin: d.origin, asOf: shortDate(d.asOf), strength: d.strength, supports: d.supports },
    ]),
  );

  const crumbs = [
    { label: vehicle ? vehicle.name : 'All vehicles', href: '/overview' },
    { label: 'Funder–vehicle fit', href: `/${slug}/fit` },
    { label: entity.displayName },
  ];

  if (!a) {
    return (
      <Page crumbs={crumbs}>
        <div className="lbl">Funder–vehicle fit</div>
        <h1>{entity.displayName}</h1>
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Not assessed</span>
              <h3>
                {all.length > 0 && !vehicle
                  ? `A fit reading is always about one vehicle. ${entity.displayName} is assessed against ${all.length === 1 ? 'one' : all.length} of them.`
                  : `Nobody has assessed ${entity.displayName} against ${vehicle ? vehicle.name : 'any vehicle'}.`}
              </h3>
              {all.length > 0 && !vehicle ? (
                <dl>
                  {all.map((x) => {
                    const v = selection.all.find((z) => z.id === x.vehicleId);
                    return (
                      <div key={x.assessmentId}>
                        <dt>
                          <Link href={`/${v?.slug ?? 'all'}/fit/${entityId}`}>{x.vehicleName}</Link>
                        </dt>
                        <dd>
                          {BLOCKER_LABEL[x.diagnosis.blocker]} · score{' '}
                          {Math.round(x.weightedFit * 100)} · {Math.round(x.evidenceCover * 100)}%
                          known
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p>
                  That is a statement about our work, not about this firm. The page fills when
                  someone answers the gates and grades the dimensions — until then there is nothing
                  here to be confident about.
                </p>
              )}
              <p style={{ marginTop: 10 }}>
                <Link href={`/orgs/${entityId}`}>Open their page</Link> — the claims, their sources
                and the ties on file are there, and they are what an assessment would be built
                from.
              </p>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  const p = a.profile;
  const moves = contributions(a.dimensions);
  const dims: DimRow[] = a.dimensions.map((x) => ({
    code: x.code, label: x.label, question: x.question, grade: x.grade, certainty: x.certainty,
    finding: x.finding, source: x.source, asOf: shortDate(x.asOf),
    weightUs: x.weightUs, weightThem: x.weightThem,
  }));

  const perceptions = [...a.perceptions].sort(
    (x, y) =>
      (SUBJECT_ORDER.indexOf(x.subjectKind) + 9) % 9 - (SUBJECT_ORDER.indexOf(y.subjectKind) + 9) % 9
      || x.subject.localeCompare(y.subject),
  );
  const aboutUs = perceptions.filter((x) => x.subjectKind === 'firm' || x.subjectKind === 'vehicle');
  const bestFam = aboutUs.reduce((m, x) => Math.max(m, FAM_RANK[x.familiarity]), -1);
  const worstSent = perceptions
    .filter((x) => FAM_RANK[x.familiarity] >= 2)
    .reduce((m, x) => Math.min(m, SENT_RANK[x.sentiment]), 9);

  const links = [...a.links].sort(
    (x, y) => (y.opinionWeight === 'strong' ? 1 : 0) - (x.opinionWeight === 'strong' ? 1 : 0),
  );
  const unclear = a.values.filter((v) => !v.clearToThem);

  return (
    <Page
      crumbs={crumbs}
      inspector={
        <>
          <div className="lbl">Where we stand</div>
          <div className="ihead">{a.entityName}</div>
          <div className="imeta">
            {a.vehicleName} · {a.exemption} · owner {a.ownerName ?? 'unassigned'}
          </div>

          <div className="kv">
            <span>Band</span>
            <span><span className={`flag ${BAND_FLAG[a.band]}`}>{a.band}</span></span>
          </div>
          <div className="kv">
            <span>Fit score</span>
            <span className="mono">{Math.round(a.weightedFit * 100)} / 100</span>
          </div>
          <div className="kv">
            <span>Rank in this vehicle</span>
            <span className="mono">{standing!.rank} of {standing!.pool}</span>
          </div>
          <div className="kv">
            <span>Last touched</span>
            <span>{shortDate(a.updatedAt)}</span>
          </div>

          <div className="scope">
            <div className="lbl">What the number is not</div>
            <p>
              It is not a probability and it is not a forecast. Two firms with the same 80 can
              need completely different work, which is what the diagnosis above the fold is for —
              the score says how well they fit, and the diagnosis says what is stopping it.
            </p>
          </div>

          {all.length > 1 && (
            <>
              <div className="lbl" style={{ marginTop: 14 }}>Same firm, other vehicles</div>
              {all.filter((x) => x.vehicleId !== a.vehicleId).map((x) => {
                const v = selection.all.find((z) => z.id === x.vehicleId);
                return (
                  <Link className="prov" href={`/${v?.slug ?? 'all'}/fit/${entityId}`} key={x.assessmentId}>
                    <div className="p1">{x.vehicleName}</div>
                    <div className="p2">
                      {BLOCKER_LABEL[x.diagnosis.blocker]} · score {Math.round(x.weightedFit * 100)}
                    </div>
                  </Link>
                );
              })}
              <div className="note">
                Read separately. Nothing on this page is summed across vehicles and no blended
                figure exists anywhere in this system.
              </div>
            </>
          )}

          <div className="acts" style={{ marginTop: 14 }}>
            <Link className="btn p" href={`/${slug}/strategy/${entityId}`}>What to do</Link>
            <Link className="btn" href={`/orgs/${entityId}`}>Their page</Link>
          </div>
        </>
      }
    >
      <div className="lbl">Funder–vehicle fit · {a.vehicleName}</div>
      <h1>{a.entityName}</h1>
      <p className="sublede">{a.headline}</p>

      <ScoreStrip a={a} standing={standing!} vehicleName={a.vehicleName} />

      {/* ---------- the diagnosis ---------- */}
      <div className={`card diag ${a.diagnosis.blocker}`}>
        <div className="chead">
          <h2>What is actually in the way</h2>
          <span className={`flag ${BLOCKER_FLAG[a.diagnosis.blocker]}`}>
            {BLOCKER_LABEL[a.diagnosis.blocker]}
          </span>
        </div>
        <div className="cbody">
          <p className="diagst">{a.diagnosis.statement}</p>
          <div className="themove">
            <div className="lbl">The move</div>
            <p>{a.diagnosis.nextMove}</p>
          </div>
        </div>
        <p className="cover">
          <b>How this is decided:</b> a precedence, not a score. A firm excluded by a gate, one who
          knows us and disagrees, one we cannot reach, one we cannot yet qualify, and one who would
          say yes in March all look the same in a pipeline and need different work — so the first
          condition that applies is the one reported.
        </p>
      </div>

      {/* ---------- hard gates ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Hard gates</h2>
          <span className="lbl">checked before any weighted score is worth reading</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 300 }}>Gate</th>
              <th style={{ width: 96 }}>Result</th>
              <th style={{ width: 66 }}>Basis</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {a.gates.map((g) => (
              <tr key={g.code}>
                <td><b>{g.label}</b></td>
                <td>{gateMark(g.passed)}</td>
                <td><CertaintyMark certainty={g.certainty} /></td>
                <td>
                  {g.detail}
                  {g.source && docMap[g.source] && <EvidenceRef doc={docMap[g.source]} />}
                  <span className="mono asof">{shortDate(g.asOf)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>Why gates come first:</b> a weighted score over a firm that cannot legally or
          structurally participate is an arithmetic exercise. An unanswered gate is not a pass —
          it is a fact nobody has gone and got.
        </p>
      </div>

      {/* ---------- firm–vehicle fit ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Firm–vehicle fit</h2>
          <span className="lbl">
            {a.strongCount}/{a.gradedCount} in our favour · score {Math.round(a.weightedFit * 100)}{' '}
            · {Math.round(a.evidenceCover * 100)}% of the weight rests on things we know
          </span>
        </div>
        <div className="cbody" style={{ paddingBottom: 0 }}>
          <FitDimensions rows={dims} docs={docMap} />
        </div>
        <p className="cover">
          <b>How the weighting works:</b> each reading counts for grade × importance-to-us ×
          certainty, so a guess moves the number less than a finding does. The result is a way of
          arguing about an order, not a probability. <b>Importance to them</b> is a separate
          column on purpose — it is what the pitch should lead with, and it frequently disagrees
          with what matters to us.
        </p>
      </div>

      {/* ---------- what moves this number (issue 0007) ---------- */}
      {moves.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>What moves this number</h2>
            <span className="lbl">score {Math.round(a.weightedFit * 100)} · sorted by how far each reading could move it</span>
          </div>
          <div className="scroller">
            <table className="list movetable">
              <thead>
                <tr>
                  <th>Reading</th>
                  <th style={{ width: 96 }}>Today</th>
                  <th style={{ width: 92 }} className="right">Supplies</th>
                  <th style={{ width: 128 }} className="right">If it went strong</th>
                  <th style={{ width: 136 }} className="right">If we verified it</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((c) => (
                  <tr key={c.code}>
                    <td>
                      <b>{c.label}</b>
                      <div className="muted mvsub">importance to us {c.weightUs}/5</div>
                    </td>
                    <td>
                      <span className={`flag ${GRADE_SIGN[c.grade] === 'for' ? 'f-ok' : GRADE_SIGN[c.grade] === 'against' ? 'f-block' : 'f-mute'}`}>
                        {GRADE_LABEL[c.grade]}
                      </span>
                      <div className="muted mvsub">{CERTAINTY_LABEL[c.certainty].toLowerCase()}</div>
                    </td>
                    <td className="right mono">{Math.round(c.supplies * 100)}</td>
                    <td className="right mono">
                      {c.headroom <= 0.0005 ? '—' : `+${Math.round(c.headroom * 100)}`}
                    </td>
                    <td className={`right mono${c.verifying <= -0.005 ? ' mvdown' : ''}`}>
                      {c.certainty === 'known'
                        ? <span className="muted">already verified</span>
                        : Math.abs(c.verifying) < 0.005
                          ? '±0'
                          : `${c.verifying > 0 ? '+' : '−'}${Math.abs(Math.round(c.verifying * 100))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cover">
            <b>Two different ways to move a score.</b> The fourth column is the finding getting
            better. The fifth is the same finding being <i>verified</i> — and it can go either
            way. Verifying a guess that is better than the average pulls the score up; verifying
            a weak one pulls it down, because the certainty discount was flattering it. Research
            can deliver the fifth column. Only the counterparty can deliver the fourth.
          </p>
          {moves[0] && moves[0].headroom < 0.035 && (
            <p className="cover">
              <b>No single reading moves this much.</b> The largest available change is{' '}
              {Math.round(moves[0].headroom * 100)} points, which means this score is not one
              argument away from anything — it is the shape of the whole assessment, and a
              conversation that fixes one reading will not move the ranking.
            </p>
          )}
          <p className="cover">
            <b>This is not a diff.</b> Issue 0007 asked which reading moved the score since the
            last assessment, and this system keeps one assessment per firm and vehicle — there is
            no earlier version to subtract. Until an assessment is versioned, the honest answer is
            what each reading is worth now, which is this table.
          </p>
        </div>
      )}

      {/* ---------- what they value ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What they value, and whether they can see it in us</h2>
          <span className="lbl">
            {unclear.length} of {a.values.length} not yet clear to them
          </span>
        </div>
        {a.values.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing recorded</span>
              <h3>Nobody has written down what this firm cares about.</h3>
              <p>
                Which means any pitch to them is being built from what we find interesting. That is
                the most common way a good fit produces a polite no.
              </p>
            </div>
          </div>
        ) : (
          <table className="list vals">
            <thead>
              <tr>
                <th style={{ width: 230 }}>What they value</th>
                <th>How we match it</th>
                <th style={{ width: 74 }}>Match</th>
                <th style={{ width: 96 }}>Clear to them</th>
                <th style={{ width: 250 }}>Next move to prove it</th>
              </tr>
            </thead>
            <tbody>
              {a.values.map((v) => (
                <tr key={v.valueId}>
                  <td><b>{v.theyValue}</b></td>
                  <td>
                    {v.ourMatch}
                    {v.source && docMap[v.source] && <EvidenceRef doc={docMap[v.source]} />}
                  </td>
                  <td><Reading grade={v.matchGrade} compact /></td>
                  <td>
                    {v.clearToThem
                      ? <span className="flag f-ok">Yes</span>
                      : <span className="flag f-ev">Not yet</span>}
                  </td>
                  <td className="muted">{v.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>Why the “clear to them” column exists:</b> a match they cannot see is worth nothing at
          the moment of decision. The difference between the two states is the whole content of
          the next conversation.
        </p>
      </div>

      {/* ---------- perception of us ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What they think of us</h2>
          <span className="lbl">
            {bestFam < 0 ? 'nothing recorded'
              : bestFam < 2 ? 'awareness gap'
              : worstSent <= 1 ? 'conviction gap' : 'known and warm'}
          </span>
        </div>
        {perceptions.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing recorded</span>
              <h3>Nothing is on file about what they think of us.</h3>
              <p>Which is not the same as them thinking nothing.</p>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 240 }}>Subject</th>
                <th style={{ width: 150 }}>How well they know it</th>
                <th style={{ width: 110 }}>Where they stand</th>
                <th style={{ width: 66 }}>Basis</th>
                <th>What that rests on</th>
              </tr>
            </thead>
            <tbody>
              {perceptions.map((x) => (
                <tr key={x.perceptionId}>
                  <td>
                    <b>{x.subject}</b>
                    <div className="muted qn">{x.subjectKind}</div>
                  </td>
                  <td>
                    <div className="famrow">
                      <span>{FAMILIARITY_LABEL[x.familiarity]}</span>
                      <Meter value={(FAM_RANK[x.familiarity] + 0.001) / 3} />
                    </div>
                  </td>
                  <td>
                    <span className={`flag ${SENT_FLAG[x.sentiment]}`}>
                      {SENTIMENT_LABEL[x.sentiment]}
                    </span>
                  </td>
                  <td><CertaintyMark certainty={x.certainty} /></td>
                  <td>
                    {x.evidence}
                    {x.source && docMap[x.source] && <EvidenceRef doc={docMap[x.source]} />}
                    <span className="mono asof">{shortDate(x.asOf)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {a.engagement.length > 0 && (
          <div className="cbody">
            <div className="lbl">Engagement we can actually observe</div>
            {a.engagement.map((e) => (
              <div className="fact" key={e.engagementId}>
                <span>{e.channel} · {e.behaviour}</span>
                <span style={{ fontWeight: 400, textAlign: 'right', maxWidth: '72%' }}>
                  {e.detail}{' '}
                  <span className="mono asof">{shortDate(e.observedOn)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="cover">
          <b>Why familiarity and sentiment are separate:</b> an awareness gap and a conviction gap
          look identical in a pipeline and need opposite work — more reach versus a specific
          objection answered. Engagement is listed separately again, because a follow is not an
          opinion: most of what moves an LP happens where we cannot see it, and a quiet feed is not
          evidence of a quiet reader.
        </p>
      </div>

      {/* ---------- links ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Ties between us</h2>
          <span className="lbl">
            {links.filter((l) => l.opinionWeight === 'strong' || l.opinionWeight === 'good').length}{' '}
            of {links.length} carry real opinion-setting weight
          </span>
        </div>
        {links.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />No tie on file</span>
              <h3>We have no recorded link to {a.entityName}.</h3>
              <p>
                No connector, no shared LP position, no overlap anybody has written down. That is a
                statement about the material in this system, not proof that no path exists — but
                until one is found, firm-level content is the only thing that reaches them.
              </p>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 190 }}>Through</th>
                <th style={{ width: 190 }}>Kind</th>
                <th>What the tie actually is</th>
                <th style={{ width: 96 }}>Tie strength</th>
                <th style={{ width: 84 }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.linkId}>
                  <td>
                    {l.viaEntityId
                      ? <Link href={`/orgs/${l.viaEntityId}`}><b>{l.viaName}</b></Link>
                      : <b>Direct</b>}
                  </td>
                  <td className="muted">{LINK_LABEL[l.kind]}</td>
                  <td>
                    {l.statement}
                    {l.source && docMap[l.source] && <EvidenceRef doc={docMap[l.source]} />}
                    <span className="mono asof">{shortDate(l.asOf)}</span>
                  </td>
                  <td className="muted">{l.tieBand}</td>
                  <td><Reading grade={l.opinionWeight} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>Tie strength and weight are different columns on purpose:</b> the strongest ties are
          not the most useful ones. Moderately weak ties move more than either strangers or close
          friends, because a close tie mostly knows the people we already know. Weight here is
          credibility with <i>this</i> firm on <i>this</i> topic — it does not transfer from one
          domain to another, and a well-known name is not automatically a good route.
        </p>
      </div>

      {/* ---------- who decides, and how we got here ---------- */}
      {p && (
        <div className="card">
          <div className="chead">
            <h2>Who decides, and how long it takes</h2>
            <span className="lbl">{FIRM_CLASS_LABEL[p.firmClass]}</span>
          </div>
          <div className="cbody">
            <div className="fact"><span>Decision architecture</span><span>{DECISION_LABEL[p.decisionArch]}</span></div>
            <div className="fact">
              <span>Typical elapsed time</span>
              <span>{p.weeksMin}–{p.weeksMax} weeks</span>
            </div>
            <div className="fact"><span>Who signs</span><span style={{ fontWeight: 400 }}>{p.whoSigns ?? 'Not established'}</span></div>
            <div className="fact"><span>Who can kill it</span><span style={{ fontWeight: 400 }}>{p.whoCanKill ?? 'Not established'}</span></div>
            <div className="fact">
              <span>Cheque they write</span>
              <span className="mono">
                {p.checkBandMin === null ? 'Not established' : `${usdM(p.checkBandMin)}–${usdM(p.checkBandMax ?? p.checkBandMin)}`}
              </span>
            </div>
            <div className="fact">
              <span>Estimated assets</span>
              <span style={{ fontWeight: 400, textAlign: 'right', maxWidth: '70%' }}>
                {p.estAum === null ? 'Not established' : usdM(p.estAum)}
                {p.aumBasis && <span className="muted"> — {p.aumBasis}</span>}{' '}
                <CertaintyMark certainty={p.aumCertainty} />
              </span>
            </div>
            <div className="fact">
              <span>Registered with the SEC</span>
              <span style={{ fontWeight: 400 }}>
                {p.iapdRegistered === null ? 'Not checked'
                  : p.iapdRegistered ? 'Yes — an adviser filing exists'
                  : 'No filing found, which for a single family office is the expected answer and usually means a faster decision'}
              </span>
            </div>
            <div className="fact">
              <span>How the relationship started</span>
              <span style={{ fontWeight: 400, textAlign: 'right', maxWidth: '70%' }}>
                {p.provenanceNote ?? 'Nothing recorded'}
                {p.provenanceSince && <span className="mono asof">{shortDate(p.provenanceSince)}</span>}
              </span>
            </div>
          </div>
          <p className="cover">
            <b>Why provenance is a field and not a note:</b> how a relationship began is a
            compliance fact on a 506(b) vehicle and a routing fact on every other one. Written down
            at the time it is cheap; reconstructed a year later it is worthless.
          </p>
        </div>
      )}

      <p className="cover" style={{ marginTop: 18 }}>
        <b>What this page covers:</b> {a.gates.length} gates, {a.gradedCount} graded dimensions,{' '}
        {a.values.length} value items, {a.perceptions.length} perception readings and {links.length}{' '}
        ties, assessed against {a.vehicleName} and last touched {shortDate(a.updatedAt)}. Everything
        here was entered by a person against a source or marked as a guess —{' '}
        {Math.round(a.evidenceCover * 100)}% of the weight rests on things we know.{' '}
        <b>Nothing on this page is inferred about anyone&rsquo;s health or their family&rsquo;s.</b>{' '}
        Stated interests are recorded from what a person said publicly about themselves and
        attributed to the source; nothing else belongs in a prospect record.
      </p>
      <p className="cover">
        <b>Basis vocabulary:</b> <i>Known</i> — {certaintyMeans('known')} <i>Inferred</i> —{' '}
        {certaintyMeans('inferred')} <i>Guess</i> — {certaintyMeans('guess')}
      </p>
    </Page>
  );
}
