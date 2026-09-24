import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { RouteGraph } from '@/components/routes/RouteGraph';
import { ProposeButton } from '@/components/routes/ProposeButton';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { Glyph } from '@/components/ui/Glyph';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { listAffiliations, listEntities } from '@/modules/identity';
import { listAsks } from '@/modules/coordination';
import { listAssessments, BLOCKER_SHORT } from '@/modules/fit';
import { TargetPicker, type TargetRow } from '@/components/routes/TargetPicker';
import { listSourceDocs, notesFor } from '@/modules/research';
import { directContact, type DirectContact } from '@/modules/meetings';
import { listVehicles } from '@/modules/platform';
import { planRoutes, tierCounts, TIER_MEANING, VERDICT_LABEL, type EvidenceTier } from '@/modules/network';
import { listPursuits } from '@/modules/strategy';
import { provisionalScores } from '@/lib/strategy-score';

export const dynamic = 'force-dynamic';

const VERDICT_FLAG: Record<string, string> = {
  recommend: 'f-ok', hold: 'f-ev', not_a_route: 'f-mute', excluded: 'f-block',
};

const TIERS: EvidenceTier[] = ['A', 'B', 'C', 'D'];

/** "Met 12 Mar 2026", "Heard from Ana Ruiz, 3 Jun 2026": the latest direct contact, in words. */
const touchWords = (c: DirectContact) => c.via
  ? `${c.how === 'met' ? 'Met' : 'Heard from'} ${c.via}, ${shortDate(c.on)}`
  : `${c.how === 'met' ? 'Met' : 'Heard from them'} ${shortDate(c.on)}`;

/** A path the research found near a target (docs/19, W3): a candidate for a person to check, never a route. */
interface CandidatePath {
  other: { type: 'team' | 'ours' | 'backer' | 'lp'; name: string; handle?: string };
  kind: string; tier: 'A' | 'B' | 'C' | 'D'; basis: string;
}
const OTHER_LABEL: Record<CandidatePath['other']['type'], string> = {
  team: 'on the team', ours: 'one of ours', backer: 'a backer of ours', lp: 'another LP',
};

export default async function Routes({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; r?: string; q?: string; sort?: string; min?: string; touch?: string }>;
}) {
  const selection = await vehicleSelection();
  const { target, r, q = '', sort: sortParam, min: minParam, touch: touchParam } = await searchParams;
  const user = await (await auth()).currentUser();
  const [entities, docs, tiers, vehicles, affiliations, fit, asks, team, pursuits] = await Promise.all([
    listEntities(), listSourceDocs(), tierCounts(), listVehicles(),
    listAffiliations(), listAssessments(selection.current?.id ?? null),
    listAsks(null), (await auth()).listUsers(), listPursuits(selection.current?.id ?? null),
  ]);

  // Targets worth showing (issues 0022–0023, real): the LPs in this pipeline and the organisations
  // they act for — not every person and firm in the replica, which made this page 1.7 MB — and
  // never a member of the team, by the team's own list.
  const teamNames = new Set(team.map((u) => u.name));
  const inPipeline = new Set(pursuits.filter((p) => !p.historical).map((p) => p.entityId));
  for (const a of affiliations) if (a.current && inPipeline.has(a.personId)) inPipeline.add(a.orgId);
  const targets = entities.filter((e) => inPipeline.has(e.entityId) && !teamNames.has(e.displayName));
  const targetId = target ?? targets.find((t) => t.displayName === 'Delia Roos')?.entityId ?? targets[0]?.entityId;
  const search = targetId
    ? await planRoutes(user.handle, targetId, 3, selection.current?.kind ?? 'fund')
    : null;

  /**
   * The picker carries the fit score, because there is no point finding a beautiful route
   * to somebody nobody has qualified — and the records around each name, so searching
   * "Kaplan" turns up the trust and the person who signs for it.
   */
  const best = new Map<string, { score: number; blocker: string | null; provisional?: boolean }>();
  // Whom the team already deals with directly (issue 0027, real): a meeting held, or word from them.
  const [provisional, contact] = await Promise.all([
    provisionalScores([...inPipeline]), directContact(targets.map((t) => t.entityId)),
  ]);
  // Where no fit assessment exists, a provisional score from the proposed strategy (issue 0022).
  for (const [id, score] of provisional) best.set(id, { score, blocker: null, provisional: true });
  for (const a of fit) {
    const hit = best.get(a.entityId);
    const score = Math.round(a.weightedFit * 100);
    // An assessment outranks a provisional score, whatever the numbers.
    if (!hit || hit.provisional || score > hit.score) {
      best.set(a.entityId, { score, blocker: BLOCKER_SHORT[a.diagnosis.blocker] });
    }
  }
  const rows: TargetRow[] = targets.map((t) => {
    const related = [
      ...affiliations.filter((x) => x.personId === t.entityId && x.current).map((x) => x.orgName),
      ...affiliations.filter((x) => x.orgId === t.entityId && x.current).map((x) => x.personName),
    ];
    /**
     * You route to a person; the fit reading sits on the institution they sign for. So a
     * person with no reading of their own borrows the best one from an organisation they
     * currently act for, and the row marks it as borrowed rather than passing it off.
     */
    const own = best.get(t.entityId) ?? null;
    const borrowedFrom = own ? null : affiliations
      .filter((x) => x.personId === t.entityId && x.current && best.has(x.orgId))
      .map((x) => ({ org: x.orgName, ...best.get(x.orgId)! }))
      .sort((a, b) => b.score - a.score)[0] ?? null;
    const reading = own ?? borrowedFrom;
    return {
      entityId: t.entityId,
      name: t.displayName,
      isPerson: t.entityType === 'person',
      score: reading?.score ?? null,
      provisional: Boolean(reading?.provisional),
      borrowedFrom: borrowedFrom?.org ?? null,
      blocker: reading?.blocker ?? null,
      related: [...new Set(related)].slice(0, 3),
      touch: contact.has(t.entityId) ? touchWords(contact.get(t.entityId)!) : null,
    };
  });
  // The server searches the targets (issue 0023): the page carries only the rows it draws.
  const SHOWN = 80;
  const sort: 'score' | 'name' = sortParam === 'name' ? 'name' : 'score';
  const minScore = [60, 75].includes(Number(minParam)) ? Number(minParam) : 0;
  const needle = q.trim().toLowerCase();
  const touchShown = touchParam === '1';
  const matching = rows
    .filter((t) => (minScore ? (t.score ?? -1) >= minScore : true))
    .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.related.some((x) => x.toLowerCase().includes(needle)));
  // In touch already: left out unless asked for, and counted, so none is dropped without a word.
  const hiddenInTouch = touchShown ? 0 : matching.filter((t) => t.touch).length;
  const matched = (touchShown ? matching : matching.filter((t) => !t.touch))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name)));
  const shown = matched.slice(0, SHOWN);
  const currentRow = rows.find((t) => t.entityId === targetId);
  if (currentRow && !shown.includes(currentRow)) shown.unshift(currentRow);
  const selected = Math.min(Math.max(0, Number(r ?? 0)), Math.max(0, (search?.routes.length ?? 1) - 1));

  /**
   * What there is besides edges (issues 0027–0028, real). The target's name comes from the records
   * even when no search ran. A search starts from the user's own person record, and a user with none
   * gets no search — which the page says, instead of "Routes to —". And whatever the edges say, what
   * the research found near them (candidates, rule 6) and whom at their firm the team already deals
   * with, since those are where a warm introduction would come from.
   */
  const targetEntity = targetId ? entities.find((e) => e.entityId === targetId) : undefined;
  const targetName = search?.targetName ?? targetEntity?.displayName ?? null;
  const edgesOnFile = tiers.reduce((n, t) => n + t.n, 0);
  const targetTouch = targetId ? contact.get(targetId) ?? null : null;
  const isPerson = targetEntity?.entityType === 'person';
  const theirFirms = isPerson ? affiliations.filter((a) => a.current && a.personId === targetId) : [];
  const nearbyPeople = new Map<string, string>(
    (isPerson
      ? affiliations.filter((a) => a.current && a.personId !== targetId && theirFirms.some((f) => f.orgId === a.orgId))
      : affiliations.filter((a) => a.current && a.orgId === targetId)
    ).map((a) => [a.personId, a.orgName]),
  );
  const [pathsNote, nearbyContact] = await Promise.all([
    targetId ? notesFor(targetId, 'connection_candidates').then((n) => n[0] ?? null) : Promise.resolve(null),
    directContact([...nearbyPeople.keys()]),
  ]);
  const candidates = ((pathsNote?.data ?? {}) as { paths?: CandidatePath[] }).paths ?? [];
  const inTouchNearby = [...nearbyContact.entries()]
    .map(([id, c]) => ({ id, c, name: affiliations.find((a) => a.personId === id)?.personName ?? 'Someone', org: nearbyPeople.get(id)! }))
    .sort((a, b) => b.c.on.getTime() - a.c.on.getTime());

  /**
   * Who should carry the ask.
   *
   * Whoever already deals with this connector, because a second person asking the same
   * favour spends the relationship twice. Then whoever already owns an ask on this target.
   * Then you — and the row says which of the three it is, because a suggestion with no
   * reason is just a default in disguise.
   */
  const suggestOwner = (connectorId: string | null) => {
    const viaConnector = connectorId
      ? asks.find((a) => a.connectorId === connectorId && a.ownerName)
      : undefined;
    if (viaConnector) {
      const who = team.find((u) => u.name === viaConnector.ownerName);
      if (who) {
        return { id: who.id, why: `${who.name} already carries an ask through this connector, and a second person asking the same favour spends the relationship twice.` };
      }
    }
    const onTarget = asks.find((a) => a.entityId === targetId && a.ownerName);
    if (onTarget) {
      const who = team.find((u) => u.name === onTarget.ownerName);
      if (who) {
        return { id: who.id, why: `${who.name} already owns an ask on this target.` };
      }
    }
    return { id: user.id, why: `Nobody here has dealt with this connector or this target before, so it falls to whoever found the route — ${user.name}.` };
  };

  const docMap = new Map<string, EvidenceDoc>(
    docs.map((d) => [
      d.docId,
      { docId: d.docId, title: d.title, origin: d.origin, asOf: shortDate(d.asOf), strength: d.strength, supports: d.supports },
    ]),
  );

  return (
    <Page
      crumbs={moduleCrumbs('routes', selection.current?.name ?? null)}
      queue={<TargetPicker targets={shown} current={targetId} matched={matched.length} total={rows.length} q={q} sort={sort} min={minScore} touchShown={touchShown} hiddenInTouch={hiddenInTouch} firstShown={Math.min(matched.length, SHOWN)} />}
      inspector={
        <>
          <div className="lbl">Evidence tiers</div>
          <div className="ihead">What each tier may carry</div>
          <div className="imeta">A–D on every edge · C and D need a person</div>
          {TIERS.map((t) => {
            const count = tiers.find((x) => x.tier === t);
            return (
              <div key={t} style={{ padding: '10px 0', borderBottom: '1px solid var(--hair)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`tier t${t}`}>{t}</span>
                  <b style={{ fontSize: 12.5, fontWeight: 500 }}>{TIER_MEANING[t].label}</b>
                  <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                    {count ? `${count.n} edge${count.n === 1 ? '' : 's'}` : '—'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 4 }}>
                  {TIER_MEANING[t].means}
                </div>
                <div style={{ fontSize: 11, marginTop: 3, color: t === 'C' || t === 'D' ? 'var(--clay)' : 'var(--green)' }}>
                  {TIER_MEANING[t].routable}
                  {count && (t === 'C' || t === 'D') ? ` ${count.reviewed} of ${count.n} reviewed.` : ''}
                </div>
              </div>
            );
          })}
          {search && search.restrictions.length > 0 && (
            <div className="warn" style={{ marginTop: 16 }}>
              <div className="lbl" style={{ color: 'var(--clay)' }}>
                Restriction on {search.targetName}
              </div>
              {search.restrictions.map((x) => (
                <p key={x.instruction}>{x.instruction}</p>
              ))}
              <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Every candidate path is checked against this, not just the one you were looking at.
              </p>
            </div>
          )}
          <div className="note">
            No graph database. Two- and three-hop enumeration is a recursive CTE over
            <code> network.link</code>, which is the edge table read in both directions.
          </div>
        </>
      }
    >
      <div className="lbl">Module 05 · Warm intro routes</div>
      <h1>Routes to {targetName ?? '—'}</h1>
      <p className="sublede">
        Two questions, answered in order. <b>May this route be used?</b> — a route is only as good
        as its worst hop, an unconfirmed tier C or D hop cannot carry one at all, and a restriction
        on the target excludes every path through the restricted party. Then, among the routes that
        may be used: <b>how much weight does it actually carry?</b>
      </p>

      {targetTouch && (
        <p className="intouch">
          <Glyph name="check" title="In touch" tone="good" />
          <span>
            <b>In touch already.</b> {touchWords(targetTouch)}, by the team&rsquo;s own record. Someone the
            team deals with directly needs no introduction; a route is for when a second voice would help.
          </span>
        </p>
      )}

      {!search ? (
        <div className="card">
          <div className="chead">
            <h2>No route search ran</h2>
            <span className="lbl">this is a statement about our records</span>
          </div>
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Not searched
              </span>
              <h3>A route starts from your own person record, and {user.name} has none here yet.</h3>
              <p>
                Routes are walked from a person in the relationship records to {targetName ?? 'the target'},
                and this user is not linked to one, so there was nowhere to start.
                {edgesOnFile === 0 && (
                  <> No relationship edges are on file yet either. What the research found near them is
                  below, as candidates: they are held as notes, not edges, until someone decides they
                  may carry a route (rule 6).</>
                )}
              </p>
              <dl>
                <dt>What is known</dt>
                <dd>
                  {edgesOnFile} relationship {edgesOnFile === 1 ? 'edge' : 'edges'} on file · {candidates.length} candidate{' '}
                  {candidates.length === 1 ? 'path' : 'paths'} from the research · {inTouchNearby.length}{' '}
                  {inTouchNearby.length === 1 ? 'person' : 'people'} {isPerson ? 'at their firm' : 'there'} the team deals with.
                </dd>
                <dt>Who can act</dt>
                <dd>Whoever keeps the records, by linking your user to your person record; anyone, by confirming a candidate with its evidence.</dd>
                <dt>Safe next step</dt>
                <dd>Read the candidates below. Where the team is in touch already, approach directly and say so.</dd>
              </dl>
            </div>
          </div>
        </div>
      ) : search.routes.length === 0 ? (
        <div className="card">
          <div className="chead">
            <h2>No supported route</h2>
            <span className="lbl">this is a statement about our records</span>
          </div>
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Nothing supported
              </span>
              <h3>
                No path from {search.fromName} to {search.targetName} exists in
                the material available.
              </h3>
              <p>
                That is not the same as &ldquo;no route exists&rdquo;. It means the edges on file do not
                connect you within {search.coverage.maxHops} hops. Someone else on the team may
                have a path — switch user in the rail and this page recomputes.
              </p>
              <dl>
                <dt>What is known</dt>
                <dd>
                  {search.coverage.edges} edges inspected, up to {search.coverage.maxHops} hops.
                </dd>
                <dt>Who can act</dt>
                <dd>Anyone who knows of a relationship we have not recorded.</dd>
                <dt>Safe next step</dt>
                <dd>Record the edge with its evidence, or approach directly and say so.</dd>
              </dl>
            </div>
          </div>
          <Coverage
            corpus={`${search.coverage.edges} relationship edges, up to ${search.coverage.maxHops} hops`}
            from={search.coverage.from ? shortDate(search.coverage.from) : null}
            to={search.coverage.to ? shortDate(search.coverage.to) : null}
            notInspected={search.coverage.notInspected}
          />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="chead">
              <h2>Routes in</h2>
              <span className="lbl">
                {search.routes.length} path{search.routes.length === 1 ? '' : 's'} · ranked by evidence, then influence
              </span>
            </div>
            {search.routes.map((route, i) => (
              <div key={i} className={`route${i === selected ? ' best' : ''}`}>
                <span className={`tier t${route.weakestTier}`}>{route.weakestTier}</span>
                <div className="rt">
                  <Link href={`/routes?target=${targetId}&r=${i}`}>
                    <b>
                      {search.fromName} → {route.hops.map((h) => h.toName).join(' → ')}
                    </b>
                  </Link>
                  {route.hops.map((h) => (
                    <p key={h.edge.edgeId} style={{ marginBottom: 3 }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {h.edge.tier} · {h.edge.kind.replace('_', ' ')} · since {h.edge.validFrom.getFullYear()}
                      </span>{' '}
                      {h.edge.evidence[0]?.note}
                      {h.edge.evidence.map((ev) =>
                        ev.doc && docMap.has(ev.doc) ? (
                          <EvidenceRef key={ev.doc} doc={docMap.get(ev.doc)!} />
                        ) : null,
                      )}
                      {h.edge.reviewedByName && (
                        <span className="muted"> · confirmed by {h.edge.reviewedByName}</span>
                      )}
                    </p>
                  ))}
                  {route.reasons.map((reason) => (
                    <p key={reason} style={{ color: route.verdict === 'recommend' ? 'var(--muted)' : 'var(--ink)' }}>
                      {reason}
                    </p>
                  ))}
                </div>
                <div className="verdict">
                  <b className={route.verdict === 'excluded' || route.verdict === 'not_a_route' ? 'stop' : ''}>
                    {VERDICT_LABEL[route.verdict]}
                  </b>
                  {route.influence && (
                    <div className="vscore">
                      <span className="mono">{Math.round(route.influence.score * 100)}</span>
                      <small>influence</small>
                    </div>
                  )}
                  {route.askLoad ? (
                    <>
                      {route.askLoad.used} of {route.askLoad.cap} asks
                      <br />
                      used this quarter
                    </>
                  ) : (
                    'direct'
                  )}
                  {route.influence && (
                    <div className="vstanding">{route.influence.standingWithUs}</div>
                  )}
                </div>
                {/* The influence table and the ask span the verdict column too. That
                    column has four short lines in it and then nothing, and reserving
                    its width down the whole card was squeezing the sentences that
                    actually need the room. */}
                <div className="rwide">
                  {route.influence && (
                    <div className="infl">
                      <div className="inflhead">
                        <span className="lbl">How much weight this carries</span>
                        <span className="inflscore">{Math.round(route.influence.score * 100)}</span>
                      </div>
                      {/* The label with its number, the bar under it, the reason beside
                          both. Reading a bar and then hunting for its sentence somewhere
                          below is work nobody does. */}
                      <table className="inflt">
                        <tbody>
                          {route.influence.components.map((c) => (
                            <tr key={c.key}>
                              <th scope="row">
                                <span className="ilab">
                                  {c.label}
                                  <span className="inum mono">
                                    {Math.round(c.score * 100)}
                                    <small>w{Math.round(c.weight * 100)}</small>
                                  </span>
                                </span>
                                <span className="ib">
                                  <i style={{ width: `${Math.round(c.score * 100)}%` }} />
                                </span>
                              </th>
                              <td className="iwhy">{c.basis}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="theask">
                        <b>The ask to make.</b> {route.influence.theAsk}
                      </p>
                    </div>
                  )}
                  {(route.verdict === 'recommend' || route.verdict === 'hold') && (
                    (() => {
                      const carrier = route.connectorIds[route.connectorIds.length - 1] ?? null;
                      const suggested = suggestOwner(carrier);
                      return (
                        <ProposeButton
                          targetId={search.targetId}
                          connectorId={carrier}
                          vehicles={vehicles.filter((v) => v.kind !== 'grant_rail')
                            .map((v) => ({ slug: v.slug, name: v.name }))}
                          owners={team.map((u) => ({ id: u.id, name: u.name }))}
                          suggestedOwnerId={suggested.id}
                          suggestion={suggested.why}
                        />
                      );
                    })()
                  )}
                </div>
              </div>
            ))}
            <Coverage
              corpus={`${search.coverage.edges} relationship edges, up to ${search.coverage.maxHops} hops`}
              from={search.coverage.from ? shortDate(search.coverage.from) : null}
              to={search.coverage.to ? shortDate(search.coverage.to) : null}
              notInspected={search.coverage.notInspected}
            />
          </div>

          <div className="card">
            <div className="chead">
              <h2>The same paths, drawn</h2>
              <span className="lbl">equal presentation, not a fallback</span>
            </div>
            <div className="cbody">
              <RouteGraph
                routes={search.routes}
                fromName={search.fromName}
                targetName={search.targetName}
                selected={selected}
              />
            </div>
            <p className="cover">
              The list above is the primary view: it is keyboard-navigable, it carries every hop&rsquo;s
              tier and evidence, and it says why each verdict was reached. This drawing adds shape and
              nothing else. Dashed lines are paths that cannot be used.
            </p>
          </div>
        </>
      )}

      {candidates.length > 0 && (
        <div className="card nearcard">
          <div className="chead">
            <h2>Near them, from the research</h2>
            <span className="lbl">{candidates.length} candidate {candidates.length === 1 ? 'path' : 'paths'} · not routes</span>
          </div>
          <div className="cbody">
            {candidates.slice(0, 12).map((x, i) => (
              <div className="pp-path" key={i}>
                <span className={`tier t${x.tier}`} title={TIER_MEANING[x.tier].label}>{x.tier}</span>
                <span>
                  <b>{x.other.name}{x.other.type === 'team' && x.other.handle === user.handle ? ' (you)' : ''}</b>
                  <span className="muted"> — {OTHER_LABEL[x.other.type] ?? x.other.type}. {x.basis}</span>
                  {(x.tier === 'C' || x.tier === 'D') && <span className="needs"> · needs a person to check</span>}
                </span>
              </div>
            ))}
            {candidates.length > 12 && <p className="muted" style={{ fontSize: 12 }}>{candidates.length - 12} more on their page.</p>}
          </div>
          <p className="cover">
            <b>What this is:</b> the research&rsquo;s path finder{pathsNote ? `, run ${shortDate(pathsNote.createdAt)}` : ''}, over our
            own records and public sources (docs/19, W3). None of it is a route yet: the paths are held as notes, not
            edges. An A or B path could carry a route once recorded as an edge, which is a decision still to make; a C or
            D path needs a person to check it first (rule 6). Not found here means not found by the research.
          </p>
        </div>
      )}

      {inTouchNearby.length > 0 && (
        <div className="card nearcard">
          <div className="chead">
            <h2>{isPerson ? 'At their firm, in touch with the team' : 'There, in touch with the team'}</h2>
            <span className="lbl">{inTouchNearby.length} {inTouchNearby.length === 1 ? 'person' : 'people'} · our own records</span>
          </div>
          <div className="cbody">
            {inTouchNearby.slice(0, 8).map((x) => (
              <div className="pp-path" key={x.id}>
                <Glyph name="check" title="In touch" tone="good" />
                <span><b>{x.name}</b> <span className="muted">— {x.org}. {touchWords(x.c)}.</span></span>
              </div>
            ))}
            {inTouchNearby.length > 8 && <p className="muted" style={{ fontSize: 12 }}>{inTouchNearby.length - 8} more.</p>}
          </div>
          <p className="cover">
            A meeting held or word from them, by the team&rsquo;s own record. {isPerson ? 'Working at the same firm is a shared affiliation, not proof that they speak (tier C): someone who knows both should say whether an introduction through them makes sense.' : 'Whoever the team deals with there is the natural way in.'}
          </p>
        </div>
      )}
    </Page>
  );
}
