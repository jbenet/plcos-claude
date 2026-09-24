import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { AssignPlay } from '@/components/plays/AssignPlay';
import { Propose } from '@/components/plays/Propose';
import { Markdown } from '@/components/ui/Markdown';
import { EntityLink } from '@/components/entity/EntityLink';
import { usdM } from '@/lib/money';
import { vehicleSelection } from '@/lib/session';
import { ago, shortDate } from '@/lib/time';
import { getEntity, orgsFor, peopleAt, AFFIL_LABEL } from '@/modules/identity';
import { assessmentFor, BLOCKER_LABEL, LINK_LABEL } from '@/modules/fit';
import { gapsForTarget, METHOD_KIND_LABEL } from '@/modules/research';
import { listExposures } from '@/modules/pipeline';
import { listPursuits, RUNG_LABEL, RUNG_REQUIRES, RUNGS, STATUS_LABEL, rungIndex } from '@/modules/strategy';
import { listAsks, restrictionsFor } from '@/modules/coordination';
import { listMeetings } from '@/modules/meetings';
import {
  assessVehicle, boardFor, commitmentsFor, listUsers, needsFor,
  LEVER_LABEL, LEVER_MEANS, NEED_CALLS_FOR, NEED_LABEL,
  type Play,
} from '@/modules/plays';

export const dynamic = 'force-dynamic';

function Board({
  plays, users, path,
}: {
  plays: Play[];
  users: Array<{ id: string; name: string; role: string }>;
  path: string;
}) {
  return (
    <table className="list board">
      <thead>
        <tr>
          <th style={{ width: 240 }}>Play</th>
          <th>Why it is on the list</th>
          <th style={{ width: 92 }}>Lever</th>
          <th style={{ width: 88 }} className="right">Leverage</th>
          <th style={{ width: 146 }}>Assign</th>
        </tr>
      </thead>
      <tbody>
        {plays.map((p) => (
          <tr key={p.playId} className={p.answersWeakness ? 'hot' : undefined}>
            <td>
              <b>{p.title}</b>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                {p.detail}
              </div>
              <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {p.entityId === null && <span className="flag f-mute">whole vehicle</span>}
                {p.gate && <span className="flag f-ev">needs {p.gate}</span>}
                <span className={`cert c-${p.certainty}`}>{p.certainty}</span>
              </div>
            </td>
            <td className="muted">
              {p.because}
              <div style={{ marginTop: 6, color: 'var(--ink)' }}>
                <b style={{ fontWeight: 500 }}>What it buys.</b> {p.payoff}
              </div>
            </td>
            <td>
              <span className={`lever${p.answersWeakness ? ' hot' : ''}`} title={LEVER_MEANS[p.lever]}>
                {LEVER_LABEL[p.lever]}
              </span>
            </td>
            <td className="right">
              <div className="lev">{p.leverage.toFixed(2)}</div>
              <div className="levsub">{p.likelihood}/5 · {p.effortDays}d · ×{p.reach}</div>
            </td>
            <td>
              <AssignPlay
                playId={p.playId} suggestedId={p.suggestedOwnerId} suggested={p.suggestedOwner}
                assignedTo={p.assignedTo} users={users} path={path}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function TargetStrategy({
  params,
}: {
  params: Promise<{ vehicle: string; target: string }>;
}) {
  const { vehicle: slug, target } = await params;
  const { all } = await vehicleSelection();
  const vehicle = all.find((v) => v.slug === slug);
  if (!vehicle) notFound();

  const entity = await getEntity(target);
  if (!entity) notFound();

  const path = `/${slug}/strategy/${target}`;
  const [
    a, needs, own, shared, users, commitments, assessment,
    exposures, pursuits, asks, meetings, restrictions, people, sits,
  ] = await Promise.all([
    assessmentFor(target, vehicle.id),
    needsFor(vehicle.id, target),
    boardFor(vehicle.id, { entityId: target }),
    boardFor(vehicle.id, { entityId: null }),
    listUsers(),
    commitmentsFor(vehicle.id, target),
    assessVehicle(vehicle.id),
    listExposures(vehicle.id),
    listPursuits(vehicle.id),
    listAsks(vehicle.id),
    listMeetings(),
    restrictionsFor(target),
    peopleAt(target),
    orgsFor(target),
  ]);
  const enrich = await gapsForTarget(vehicle.id, target);

  const weak = new Set(assessment?.weakLevers ?? []);
  const mark = (p: Play) => ({ ...p, answersWeakness: weak.has(p.lever) });
  const rank = (x: Play, y: Play) =>
    Number(y.answersWeakness) - Number(x.answersWeakness) || y.leverage - x.leverage;

  const plays = own.map(mark).sort(rank);
  /** Whole-vehicle plays whose lever answers something this target actually needs. */
  const needLevers = new Set(needs.filter((n) => n.met === false || n.met === null)
    .flatMap((n) => LEVERS_FOR_NEED[n.kind] ?? []));
  const alsoRelevant = shared.map(mark).filter((p) => needLevers.has(p.lever)).sort(rank).slice(0, 4);

  const mine = exposures.filter((x) => x.entityId === target);
  const pursuit = pursuits.find((p) => p.entityId === target) ?? null;
  const theirAsks = asks.filter((x) => x.entityId === target);
  const theirMeetings = meetings.filter((m) => m.entityId === target);
  const lastTouch = [
    ...theirAsks.map((x) => x.madeAt).filter(Boolean) as Date[],
    ...theirMeetings.map((m) => m.heldOn).filter(Boolean) as Date[],
  ].sort((x, y) => y.getTime() - x.getTime())[0] ?? null;

  const unmet = needs.filter((n) => n.met === false);
  const unknownNeeds = needs.filter((n) => n.met === null);

  return (
    <Page
      crumbs={[
        { label: vehicle.name, href: '/overview' },
        { label: 'Strategy', href: `/${slug}/strategy` },
        { label: entity.displayName },
      ]}
      inspector={
        <>
          <div className="lbl">State of play</div>
          <div className="ihead">{entity.displayName}</div>
          <div className="imeta">{vehicle.name} · {vehicle.exemption}</div>

          {a ? (
            <>
              <div className="kv"><span>Fit score</span><span className="mono">{Math.round(a.weightedFit * 100)} / 100</span></div>
              <div className="kv"><span>What is in the way</span><span>{BLOCKER_LABEL[a.diagnosis.blocker]}</span></div>
              <div className="kv"><span>Rests on things we know</span><span className="mono">{Math.round(a.evidenceCover * 100)}%</span></div>
            </>
          ) : (
            <div className="note">Not assessed against this vehicle. The board below is thin for a reason.</div>
          )}
          <div className="kv"><span>Status</span><span>{pursuit ? STATUS_LABEL[pursuit.status] : 'no pursuit'}</span></div>
          <div className="kv"><span>On the ladder</span><span>{pursuit?.rung ? RUNG_LABEL[pursuit.rung] : pursuit ? 'nothing yet' : '—'}</span></div>
          <div className="kv"><span>Needs unmet</span><span>{unmet.length} of {needs.length}</span></div>
          <div className="kv"><span>Plays</span><span>{plays.length}</span></div>
          <div className="kv"><span>Last touch</span><span>{lastTouch ? ago(lastTouch) : 'never'}</span></div>

          <div className="scope">
            <div className="lbl">Needs shape the strategy</div>
            <p>
              &ldquo;They do not understand the field&rdquo; and &ldquo;they do not believe we
              get into the deals&rdquo; both read as <i>not convinced</i> and call for completely
              different work. The needs table below is the bridge from the diagnosis to the board.
            </p>
          </div>

          <div className="acts" style={{ marginTop: 14 }}>
            <Link className="btn" href={`/${slug}/fit/${target}`}>Full fit reading</Link>
            <Link className="btn" href={`/orgs/${target}`}>Their page</Link>
          </div>
        </>
      }
    >
      <div className="lbl">Strategy · {vehicle.name}</div>
      <h1>{entity.displayName}</h1>
      <p className="sublede">
        {a?.headline ?? 'No fit reading exists for this pairing yet, so everything below rests on what else is recorded.'}
      </p>

      {restrictions.length > 0 && (
        <div className="card" style={{ boxShadow: 'inset 3px 0 0 var(--clay)' }}>
          <div className="chead">
            <h2>Do not approach</h2>
            <span className="lbl">checked against every play below</span>
          </div>
          <div className="cbody">
            {restrictions.map((r) => (
              <div className="fact" key={r.restrictionId} style={{ display: 'block' }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.instruction}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  {r.scope}{r.connectorName ? ` · ${r.connectorName}` : ''} · {shortDate(r.recordedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- 1. state of play ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Where we actually are</h2>
          <span className="lbl">read from the records that own each fact</span>
        </div>
        <table className="list">
          <tbody>
            <tr>
              <td style={{ width: 190 }}><b>Fit</b></td>
              <td>
                {a ? (
                  <>
                    <Link href={`/${slug}/fit/${target}`}>
                      <b>{Math.round(a.weightedFit * 100)} / 100</b>
                    </Link>{' '}
                    · {a.strongCount} of {a.gradedCount} dimensions in our favour ·{' '}
                    {Math.round(a.evidenceCover * 100)}% rests on things we know
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                      {a.diagnosis.statement}
                    </div>
                  </>
                ) : <span className="muted">Nobody has assessed them against this vehicle.</span>}
              </td>
            </tr>
            <tr>
              <td><b>Status</b></td>
              <td>
                {pursuit ? (
                  <>
                    <Link href={`/targets/${pursuit.pursuitId}`}>{STATUS_LABEL[pursuit.status]}</Link>
                    {pursuit.nextStep && <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>Next: {pursuit.nextStep}</div>}
                  </>
                ) : <span className="muted">No pursuit open.</span>}
              </td>
            </tr>
            <tr>
              <td><b>Consent ladder</b></td>
              <td>
                {pursuit?.rung ? (
                  <>
                    {RUNG_LABEL[pursuit.rung]}{' '}
                    <span className="muted">
                      · rung {rungIndex(pursuit.rung) + 1} of {RUNGS.length}
                    </span>
                    {pursuit.nextRung && (
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                        Next: {RUNG_LABEL[pursuit.nextRung]} — {RUNG_REQUIRES[pursuit.nextRung]}
                      </div>
                    )}
                  </>
                ) : <span className="muted">No pursuit open. Nothing has been evidenced.</span>}
              </td>
            </tr>
            <tr>
              <td><b>Money on file</b></td>
              <td className="mono">
                {mine.length === 0 ? <span className="muted">none</span> : mine.map((x) => (
                  <div key={x.exposureId} style={{ color: x.track === 'hard' ? 'var(--green)' : undefined }}>
                    {usdM(x.amount)} {x.track} · {x.instrument.replace(/_/g, ' ')}
                  </div>
                ))}
              </td>
            </tr>
            <tr>
              <td><b>Route</b></td>
              <td>
                {a && a.links.length > 0 ? (
                  a.links.map((l) => (
                    <div key={l.linkId} style={{ marginBottom: 3 }}>
                      {l.viaEntityId
                        ? <EntityLink id={l.viaEntityId} name={l.viaName ?? 'someone'} />
                        : <b>Direct</b>}
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {' '}· {LINK_LABEL[l.kind]} · {l.tieBand} tie
                      </span>
                      {l.opinionWeight === 'blocker' && (
                        <span className="flag f-block" style={{ marginLeft: 6 }}>restricted</span>
                      )}
                    </div>
                  ))
                ) : <span className="muted">No tie on file.</span>}
              </td>
            </tr>
            <tr>
              <td><b>Who we deal with</b></td>
              <td>
                {people.filter((p) => p.current).length === 0
                  ? <span className="muted">Nobody recorded. Every route is to an institution rather than a person.</span>
                  : people.filter((p) => p.current).map((p) => (
                      <div key={p.affiliationId} style={{ marginBottom: 2 }}>
                        <EntityLink id={p.personId} name={p.personName} />
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {' '}· {AFFIL_LABEL[p.kind]} · {p.role}
                        </span>
                      </div>
                    ))}
                {sits.filter((x) => x.current).map((x) => (
                  <div className="muted" key={x.affiliationId} style={{ fontSize: 11.5 }}>
                    Acts for <Link href={`/orgs/${x.orgId}`}>{x.orgName}</Link> · {AFFIL_LABEL[x.kind]}
                  </div>
                ))}
              </td>
            </tr>
            <tr>
              <td><b>Contact</b></td>
              <td className="muted">
                {theirAsks.length} ask{theirAsks.length === 1 ? '' : 's'} ·{' '}
                {theirMeetings.length} meeting{theirMeetings.length === 1 ? '' : 's'} ·{' '}
                {lastTouch ? `last touched ${ago(lastTouch)}` : 'never touched'}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="cover">
          <b>Nothing on this row is stored here.</b> The fit reading, the rung, the money, the
          ties and the people all live in the modules that own them, so this page cannot
          disagree with the pages they come from.
        </p>
      </div>

      {/* ---------- 2. what they need ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What they need before they can say yes</h2>
          <span className="lbl">
            {unmet.length} unmet · {unknownNeeds.length} nobody has established
          </span>
        </div>
        {needs.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing recorded</span>
              <h3>Nobody has written down what {entity.displayName} needs.</h3>
              <p>
                Which means the board below is aimed at a guess. A need is not the same as a fit
                reading: fit says whether they <i>should</i> want this, a need says what is
                missing between here and a yes.
              </p>
            </div>
          </div>
        ) : (
          <table className="list needrow fixed">
            <thead>
              <tr>
                <th style={{ width: 146 }}>What is missing</th>
                <th style={{ width: 92 }}>Standing</th>
                <th style={{ width: 240 }}>In their terms</th>
                <th>How we know</th>
                <th style={{ width: 218 }}>What that calls for</th>
              </tr>
            </thead>
            <tbody>
              {needs.map((n) => (
                <tr key={n.needId}>
                  <td><b>{NEED_LABEL[n.kind]}</b></td>
                  <td>
                    {n.met === true ? <span className="flag f-ok">Met</span>
                      : n.met === false ? <span className="flag f-block">Not met</span>
                      : <span className="flag f-ev">Not established</span>}
                  </td>
                  <td>{n.statement}</td>
                  <td className="muted">
                    {n.evidence}
                    <span className="mono asof">{shortDate(n.asOf)}</span>
                  </td>
                  <td className="muted">{NEED_CALLS_FOR[n.kind]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>This table is the bridge from diagnosis to action.</b> Two funders can both read as
          &ldquo;not convinced&rdquo; and need opposite work — one has never heard of the field,
          the other has and doubts we can get into the rounds. A play aimed at the wrong need
          converts nothing and costs the same.
        </p>
      </div>

      {/* ---------- 3. the option space ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What we could do</h2>
          <span className="lbl">{plays.length} aimed at {entity.displayName} · ranked by leverage</span>
        </div>
        {plays.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing on the board</span>
              <h3>No play is written down for this pairing.</h3>
              <p>
                That is a statement about our thinking, not about the option space. Start from the
                unmet needs above — each one names the kind of work that would answer it.
              </p>
            </div>
          </div>
        ) : (
          <Board plays={plays} users={users} path={path} />
        )}
        <p className="cover">
          <b>Think laterally here.</b> The highest-converting move is often not another email: an
          LP joined this fund after finding a podcast episode, learning the domain and hearing
          the thesis argued — nobody sent them anything. <i>Convene</i> and <i>reach</i> exist on
          this board because a room and a piece of work sometimes beat a route.
        </p>
      </div>

      {alsoRelevant.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Whole-vehicle plays that would help here</h2>
            <span className="lbl">matched to this target&rsquo;s unmet needs</span>
          </div>
          <div className="worknote">
            These are not aimed at {entity.displayName}, and each one would answer something they
            need. Work that fixes the same problem for several funders at once is usually the
            better week.
          </div>
          <Board plays={alsoRelevant} users={users} path={path} />
        </div>
      )}

      {/* ---------- 3b. what we do not know about them ---------- */}
      {enrich.gaps.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>What we do not know about them</h2>
            <span className="lbl">
              {enrich.gaps.length} open · {enrich.methods.length} method
              {enrich.methods.length === 1 ? '' : 's'} would close some of it
            </span>
          </div>
          <div className="worknote">
            {a && a.evidenceCover < 0.8
              ? `Only ${Math.round(a.evidenceCover * 100)}% of this reading rests on things we know. `
                + 'Enrichment is usually the cheapest play on the page, and it is the one that '
                + 'decides whether the rest of it can be trusted.'
              : 'Each of these is a guess or a question nobody asked. Closing one is usually an '
                + 'hour, and it changes what the rest of this page is worth.'}
          </div>
          <table className="list fixed">
            <thead>
              <tr>
                <th style={{ width: 182 }}>What is missing</th>
                <th style={{ width: 92 }}>Kind</th>
                <th>Why it is a gap</th>
                <th style={{ width: 300 }}>What would close it</th>
              </tr>
            </thead>
            <tbody>
              {enrich.gaps.map((g) => {
                const fills = enrich.methods.filter((m) => m.yields.includes(g.code));
                return (
                  <tr key={`${g.kind}:${g.code}`}>
                    <td><b>{g.label}</b></td>
                    <td>
                      <span className={`flag ${g.kind === 'gate' ? 'f-ev' : 'f-mute'}`}>
                        {g.kind === 'gate' ? 'hard gate' : 'dimension'}
                      </span>
                    </td>
                    <td className="muted">{g.why}</td>
                    <td>
                      {fills.length === 0 ? (
                        <span className="muted">
                          Nothing in the catalogue covers this. It will have to be asked.
                        </span>
                      ) : (
                        fills.slice(0, 3).map((m) => (
                          <div key={m.methodId} style={{ marginBottom: 4 }}>
                            <span className="lever">{METHOD_KIND_LABEL[m.kind]}</span>{' '}
                            <span style={{ fontSize: 11.5 }}>{m.name}</span>
                            <div className="muted" style={{ fontSize: 10.5 }}>
                              tier {m.producesTier} ceiling
                              {m.effortDays > 0 ? ` · ${m.effortDays}d` : ' · free'}
                              {m.status !== 'available' ? ` · ${m.status}` : ''}
                            </div>
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="cover">
            <b>Tier is a ceiling, not a hope.</b> A method that produces tier D produces tier D
            however much of it there is — a follow graph is a discovery clue and never a
            relationship. The full catalogue, with costs and the methods we have rejected, is on{' '}
            <Link href="/research/enrichment">Research corpus → Enrichment</Link>.
          </p>
        </div>
      )}

      {/* ---------- 4. commit ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Propose and commit</h2>
          <span className="lbl">for {entity.displayName}</span>
        </div>
        <Propose
          vehicleId={vehicle.id}
          entityId={target}
          path={path}
          placeholder={
            `What are we going to do about ${entity.displayName}?\n\n`
            + '- one line per thing\n'
            + '- @handle to name somebody\n'
            + '- a date if there is one (2026-10-03)\n'
          }
        />
      </div>

      {commitments.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Committed</h2>
            <span className="lbl">{commitments.length}</span>
          </div>
          {commitments.map((c) => (
            <div className="row" key={c.commitmentId} style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 118, flex: 'none' }}>
                <div className="mono" style={{ fontSize: 11 }}>{shortDate(c.writtenAt)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{c.writtenByName}</div>
              </div>
              <div className="t">
                <Markdown source={c.body} />
                {c.handoff && (
                  <details>
                    <summary className="lbl" style={{ cursor: 'pointer', marginTop: 6 }}>
                      Linear ticket · {c.handoff.state}
                    </summary>
                    <pre className="handoff">{JSON.stringify(c.handoff.payload, null, 2)}</pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="cover">
        <b>What this page covers:</b> the fit reading, ladder rung, money, ties and people
        recorded for {entity.displayName} against {vehicle.name}; {needs.length} needs; and{' '}
        {plays.length + alsoRelevant.length} plays. <b>Nothing is generated</b> — every play and
        every need was written by a person against something in this database.
      </p>
    </Page>
  );
}

/** Which levers answer which need. The bridge, as a table rather than as a paragraph. */
const LEVERS_FOR_NEED: Record<string, string[]> = {
  know_domain: ['materials', 'reach', 'convene'],
  know_us: ['reach', 'convene', 'route', 'materials'],
  believe_returns: ['materials', 'validate', 'convince'],
  believe_access: ['materials', 'validate', 'convene'],
  validation: ['validate', 'route'],
  mechanics: ['process', 'materials', 'convince'],
  timing: ['convene', 'reach'],
  permission: ['enrich', 'convince', 'process'],
};
