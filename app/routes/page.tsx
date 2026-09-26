import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { RouteNames } from '@/components/routes/RouteNames';
import { ConnectionFeedback } from '@/components/routes/ConnectionFeedback';
import { RouteGraph } from '@/components/routes/RouteGraph';
import { ProposeButton } from '@/components/routes/ProposeButton';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { Glyph } from '@/components/ui/Glyph';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { listEntities } from '@/modules/identity';
import { TargetPicker } from '@/components/routes/TargetPicker';
import { listSourceDocs, notesFor } from '@/modules/research';
import { directContact, type DirectContact } from '@/modules/meetings';
import { planRoutes, warmthReader, routePage, ROUTES_PER_PAGE, tieWarmth, TIER_MEANING, VERDICT_LABEL, type EvidenceTier } from '@/modules/network';
import type { Path } from '@/lib/enrich/connect';
import { buildNetworkAction } from './actions';
import { routeInputs, promotedRouteBases } from '@/lib/routes-data';

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
type CandidatePath = Path;
const OTHER_LABEL: Record<CandidatePath['other']['type'], string> = {
  team: 'on the team', ours: 'one of ours', backer: 'a backer of ours', lp: 'another LP',
};

export default async function Routes({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; r?: string; q?: string; sort?: string; min?: string; touch?: string; expanded?: string; page?: string; family?: string }>;
}) {
  const selection = await vehicleSelection();
  const params = await searchParams;
  const { target, r, q = '', sort: sortParam, min: minParam, touch: touchParam, expanded, page, family } = params;
  const user = await (await auth()).currentUser();
  const { tiers, vehicles, affiliations, asks, team, entities: pipelineEntities, targets, contact, rows } =
    await routeInputs(selection.current?.id ?? '');
  const entities = target && !pipelineEntities.some((e) => e.entityId === target)
    ? [...pipelineEntities, ...await listEntities([target])] : pipelineEntities;
  const targetId = target ?? targets.find((t) => t.displayName === 'Delia Roos')?.entityId ?? targets[0]?.entityId;
  const search = targetId
    ? await planRoutes(user.handle, targetId, 3, selection.current?.kind ?? 'fund', 'team')
    : null;

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
  const presentation = routePage(search?.routes ?? [], { expanded, page, selected: r, family });
  const { shown: displayedRoutes, selected, alternatives } = presentation;
  const readWarmth = warmthReader();
  const routeHref = (changes: Record<string, string | undefined>) => {
    const values = { ...params, target: targetId, ...changes };
    const query = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined));
    return `/routes?${query}`;
  };

  /**
   * What there is besides edges (issues 0027–0028, real). The target's name comes from the records
   * even when no search ran. A search starts from the team and PL source records, and a user with none
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
  const promotedBases = promotedRouteBases(search?.routes ?? []);
  const candidates = (((pathsNote?.data ?? {}) as { paths?: CandidatePath[] }).paths ?? [])
    .filter((p) => !promotedBases.has(p.basis));
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

  const docs = await listSourceDocs([...new Set(displayedRoutes
    .flatMap(({ route }) => route.hops.flatMap((hop) => hop.edge.evidence.flatMap((ev) => ev.doc ? [ev.doc] : []))))]);
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
          <div className="imeta">A–D on every edge · uncertainty stays visible</div>
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
        Routes start with the team or PL. Evidence tiers and relationship warmth show how much
        weight each path carries; C and D ties stay visible with their uncertainty labelled.
        A restriction on the target still excludes the approach. Asks and sends need separate approval.

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
                <dd>Anyone: building the network links each of the team to a person record and makes the ties our records show — a meeting held one to one is tier A — and those the research found, C and D labelled as weaker evidence.</dd>
                <dt>Safe next step</dt>
                <dd>Build it below. Where the team is in touch already, approach directly and say so.</dd>
              </dl>
              <form action={buildNetworkAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="target" value={targetId ?? ''} />
                <button className="btn p" type="submit">Build the network from our records and the research</button>
              </form>
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
                connect you within {search.coverage.maxHops} hops. The team and PL organization sources are included; new evidence can add more paths.
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
                {displayedRoutes.length} shown · {presentation.first}–{presentation.last} of {presentation.eligibleCount} {presentation.family !== null ? 'in this route family' : expanded === '1' ? 'including alternatives' : 'main routes'} · {search.routes.length} recorded
                <span style={{ display: 'block' }}>Evidence, warmth, then influence</span>
                {presentation.family !== null && <> · <Link href={routeHref({ family: undefined, page: undefined, r: undefined })}>Back to ranked routes</Link></>}
                {expanded === '1' && <> · <Link href={routeHref({ expanded: undefined, family: undefined, page: undefined, r: undefined })}>Fold redundant alternatives</Link></>}
              </span>
            </div>
            {displayedRoutes.map(({ route, index: i }) => (
              <div key={i} className={`route${i === selected ? ' best' : ''}`}>
                <span className={`tier t${route.weakestTier}`}>{route.weakestTier}</span>
                <div className="rt">
                  <RouteNames route={route} alternatives={(alternatives.get(i) ?? []).map((x) => x.route)} fromName={route.fromName ?? search.fromName} />
                  <div><Link href={routeHref({ r: String(i) })}>Inspect this route</Link></div>
                  {route.hops.map((h) => (
                    <div key={h.edge.edgeId}>
                      <p style={{ marginBottom: 3 }}>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {h.edge.tier} · {h.edge.kind.replace('_', ' ')} · edge dated {h.edge.validFrom.getFullYear()}
                        </span>{' '}
                        <span className="muted" style={{ display: 'block' }}>{readWarmth(h.edge).basis}</span>
                        {h.edge.evidence.map((ev, ei) => (
                          <span key={ei} style={{ display: 'block' }}>
                            {ev.note}{' '}
                            {ev.doc && docMap.has(ev.doc) && <EvidenceRef doc={docMap.get(ev.doc)!} />}
                            {ev.source && (/^https?:\/\//.test(ev.source)
                              ? <a href={ev.source} target="_blank" rel="noreferrer">Source</a>
                              : <span className="muted">{ev.source}</span>)}
                            {ev.as_of && <span className="muted"> · recorded {ev.as_of}</span>}
                          </span>
                        ))}
                        {h.edge.reviewedByName && (
                          <span className="muted"> · confirmed by {h.edge.reviewedByName}</span>
                        )}
                      </p>

                    </div>
                  ))}
                  {route.reasons.map((reason) => (
                    <p key={reason} style={{ color: route.verdict === 'recommend' ? 'var(--muted)' : 'var(--ink)' }}>
                      {reason}
                    </p>
                  ))}
                  {expanded !== '1' && presentation.family === null && alternatives.has(i) && (
                    <details>
                      <summary>{alternatives.get(i)!.length} alternative paths and evidence</summary>
                      <p>These paths share the same destination chain or add a weaker detour. Their evidence is retained.
                        {alternatives.get(i)!.length > 8 && <> The first 8 are shown here.</>}</p>
                      {alternatives.get(i)!.slice(0, 8).map(({ route: alternative, index: ai }) => (
                        <p key={ai}><Link href={routeHref({ r: String(ai), family: String(i), page: undefined })}>
                          {alternative.fromName ?? search.fromName} → {alternative.hops.map((h) => h.toName).join(' → ')} · inspect evidence
                        </Link></p>
                      ))}
                      <p><Link href={routeHref({ family: String(i), r: undefined, page: undefined })}>View all {alternatives.get(i)!.length} alternatives and their evidence</Link></p>
                    </details>
                  )}
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
            {presentation.pages > 1 && <nav aria-label="Route pages" style={{ padding: 16, display: 'flex', gap: 16 }}>
              {presentation.page > 0 && <Link href={routeHref({ page: String(presentation.page - 1), r: undefined })}>Previous {ROUTES_PER_PAGE} routes</Link>}
              <span>Page {presentation.page + 1} of {presentation.pages}</span>
              {presentation.page + 1 < presentation.pages && <Link href={routeHref({ page: String(presentation.page + 1), r: undefined })}>Show next {Math.min(ROUTES_PER_PAGE, presentation.eligibleCount - presentation.last)} routes</Link>}
            </nav>}
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
                routes={displayedRoutes.map(({ route }) => route)}
                fromName={search.fromName}
                targetName={search.targetName}
                selected={Math.max(0, displayedRoutes.findIndex(({ index }) => index === selected))}
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

      {targetId && <ConnectionFeedback key={targetId} lp={targetId} />}

      {candidates.length > 0 && (
        <div className="card nearcard">
          <div className="chead">
            <h2>Near them, from the research</h2>
            <span className="lbl">{candidates.length} candidate {candidates.length === 1 ? 'path' : 'paths'} · outside the imported routes</span>
          </div>
          <div className="cbody">
            {candidates.slice(0, 12).map((x, i) => (
              <div className="pp-path" key={i}>
                <span className={`tier t${x.tier}`} title={TIER_MEANING[x.tier].label}>{x.tier}</span>
                <span>
                  <b>{x.other.name}{x.other.type === 'team' && x.other.handle === user.handle ? ' (you)' : ''}</b>
                  <span className="muted"> — {OTHER_LABEL[x.other.type] ?? x.other.type}. {x.basis}</span>
                  <span className="muted" style={{ display: 'block' }}>{tieWarmth(x.kind, x.tie ?? ((x.tier === 'C' || x.tier === 'D') ? { kind: 'proximity' } : undefined)).basis}</span>
                  {(x.tier === 'C' || x.tier === 'D') && <span className="needs"> · weaker evidence</span>}
                </span>
              </div>
            ))}
            {candidates.length > 12 && <p className="muted" style={{ fontSize: 12 }}>{candidates.length - 12} more on their page.</p>}
          </div>
          <p className="cover">
            <b>What this is:</b> the research&rsquo;s path finder{pathsNote ? `, run ${shortDate(pathsNote.createdAt)}` : ''}, over our
            own records and public sources (docs/19, W3). Paths already carried by a usable route appear above.
            These remaining candidates are not connected to a route source in the imported graph.
            C and D ties route with labelled uncertainty (rule 6). Not found here means not found by the research.
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
