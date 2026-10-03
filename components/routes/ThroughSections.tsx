import Link from '@/components/ui/AppLink';
import { RouteGraph } from '@/components/routes/RouteGraph';
import { Coverage } from '@/components/ui/Coverage';
import { graphRouteInputs } from '@/lib/authz/read/routes';
import { STATUS_LABEL } from '@/lib/authz/read/strategy';
import { SOURCE_MEANS, TIER_MEANING, warmthReader, type Route, type ThroughView, type OnwardTie } from '@/lib/authz/read/network';

/** How many onward ties the map draws beside the routes in; the table below lists them all, paged. */
const MAP_TIES = 12;
const MAP_ROUTES_IN = 6;

const kindWords = (kind: string) => kind.replaceAll('_', ' ');
const statusWords = (status: string) => (STATUS_LABEL as Record<string, string>)[status] ?? status;

/** X's onward tie as a one-hop route from X, so the ordinary map can draw it to the right of X. */
function onwardRoute(view: ThroughView, tie: OnwardTie, groups: Record<string, string>): Route {
  const edge = tie.edges[0]!;
  return {
    // Share the map nodes our routes in already use for the same possible identity.
    identityGroups: { [view.nodeId]: groups[view.nodeId] ?? view.nodeId, [tie.otherId]: groups[tie.otherId] ?? tie.otherId },
    fromEntity: view.nodeId, fromName: view.nodeName,
    hops: [{ edge, toEntity: tie.otherId, toName: tie.otherName }],
    connectorIds: [], connectorNames: [], verdict: 'recommend', weakestTier: edge.tier, askLoad: null, influence: null,
    reasons: [`${view.nodeName} → ${tie.otherName}: ${kindWords(edge.kind)}, tier ${edge.tier}. ${tie.lps.length ? `An LP we pursue (${tie.lps.map((l) => l.vehicleName).join(', ')}).` : ''} A tie on file, not an introduction anyone has offered.`],
  };
}

/** The tiers along us → … → X → Y, in words. */
function combinedWords(view: ThroughView, tie: OnwardTie) {
  if (view.source) return `${view.nodeName} → ${tie.otherName}. ${view.nodeName} is one of ours, so the route is this tie alone.`;
  if (!view.bestRoute) return `No usable route to ${view.nodeName} is on file, so this tie does not yet make a route.`;
  const r = view.bestRoute;
  return `${r.fromName ?? 'Team / PL'} → ${r.hops.map((h) => h.toName).join(' → ')} → ${tie.otherName}. Weaker of ${r.weakestTier} (our best route to ${view.nodeName}) and ${tie.edges[0]!.tier} (their tie).`;
}

/** The ordinary route map, centred on X: our routes in on the left, X's ties out on the right. */
export function ThroughMap({ view, routesIn, routeIds, founders }: {
  view: ThroughView;
  /** Our routes to X currently displayed in the comparison list, and their list indices. */
  routesIn: Route[];
  routeIds: number[];
  founders: Record<string, string[]>;
}) {
  // Someone already on our way to X is not someone X introduces us to: drawing both makes a loop.
  // Routes in that pass through a drawn tie leave the map (never the list); if none would remain,
  // those ties leave the map instead.
  const usable = routesIn.filter((r) => r.verdict === 'recommend');
  const topTies = view.onward.slice(0, MAP_TIES), tieIds = new Set(topTies.map((t) => t.otherId));
  const clear = usable.filter((r) => !r.hops.slice(0, -1).some((h) => tieIds.has(h.toEntity)) && !tieIds.has(r.fromEntity ?? ''));
  const pool = clear.length || !usable.length ? clear : usable;
  const inRoutes = pool.slice(0, MAP_ROUTES_IN);
  const onTheWay = new Set(inRoutes.flatMap((r) => [r.fromEntity ?? '', ...r.hops.map((h) => h.toEntity)]));
  const ties = topTies.filter((t) => !onTheWay.has(t.otherId));
  const leftOff = usable.length - pool.length + topTies.length - ties.length;
  const groups: Record<string, string> = Object.assign({}, ...inRoutes.map((r) => r.identityGroups ?? {}));
  const mapRoutes = graphRouteInputs([...inRoutes, ...ties.map((t) => onwardRoute(view, t, groups))]);
  const anchors = [...inRoutes.map((r) => `route-${routeIds[routesIn.indexOf(r)]}`), ...ties.map((_, i) => `through-${i}`)];
  return (
      <details className="card route-graph-section through-map" open>
        <summary>Through map <span className="muted">· {inRoutes.length} of our routes in · {ties.length} of {view.onward.length} ties out · one node per person</span></summary>
        {mapRoutes.length > 0 ? (
          <RouteGraph routes={mapRoutes} fromName="Team / PL" targetName={view.nodeName} selected={0} pageSize={mapRoutes.length}
            anchors={anchors} portfolioFounders={founders} centerOn={groups[view.nodeId] ?? view.nodeId}
            label={`Routes through ${view.nodeName}: our side on the left, ${view.nodeName} in the middle, their ties on the right`} />
        ) : (
          <p className="cbody muted">Nothing to draw: no usable route to {view.nodeName} and no onward tie on file.</p>
        )}
        <p className="route-map-key">Left: our routes to {view.nodeName} (best {MAP_ROUTES_IN} shown). Right: {view.nodeName}&rsquo;s ties onward, LPs we pursue first (best {MAP_TIES}). An onward arc is a tie on file, not an offer to introduce.{leftOff > 0 && ` ${leftOff} more left off the map, to keep anyone from appearing on both sides; the lists below have them all.`}</p>
      </details>
  );
}

/** X's onward ties with the combined two-hop reading, then the gaps panel. */
export function ThroughSections({ view, hrefFor, moreHref, shown }: {
  view: ThroughView;
  hrefFor: (target: string, mode: 'to' | 'through') => string;
  moreHref: (n: number) => string;
  shown: number;
}) {
  const readWarmth = warmthReader();
  const lpTies = view.onward.filter((t) => t.lps.length > 0).length;
  const rows = view.onward.slice(0, shown);
  const g = view.gaps;

  return (
    <>

      <div className="card through-onward" id="through-onward">
        <div className="chead">
          <h2>Who {view.nodeName} could introduce us to</h2>
          <span className="lbl">{view.onward.length} ties · {lpTies} to LPs we pursue</span>
        </div>
        {view.nodeRestricted ? (
          <div className="cbody warn">
            <p><b>Nothing is offered through {view.nodeName}.</b> A do-not-approach instruction is on file for them, and a route
              through someone who asked not to be approached would go around it (rule 8). Their edges are still counted below, for the record.</p>
          </div>
        ) : view.onward.length === 0 ? (
          <p className="cbody">No onward tie on file for {view.nodeName}. That is a statement about our records, not about whom they know.</p>
        ) : (
          <table className="list through-table">
            <thead><tr><th>Through {view.nodeName} to</th><th>LP</th><th>Tie</th><th>Evidence</th><th>Route us → {view.nodeName} → them</th></tr></thead>
            <tbody>
              {rows.map((tie, i) => {
                const edge = tie.edges[0]!;
                return (
                  <tr key={tie.otherId} id={`through-${i}`}>
                    <td>
                      <b>{tie.otherName}</b>
                      <div className="through-links">
                        <Link href={hrefFor(tie.otherId, 'to')}>Routes to</Link> · <Link href={hrefFor(tie.otherId, 'through')}>Through them</Link>
                      </div>
                    </td>
                    <td>{tie.lps.length ? tie.lps.map((lp) => (
                      <div key={`${lp.entityId}:${lp.vehicleSlug}`} className="through-lp">
                        <b>{lp.vehicleName}</b> · {statusWords(lp.status)}
                        {lp.via === 'contact' && <span className="muted"> · {lp.role ?? 'contact'} for {lp.name}</span>}
                      </div>
                    )) : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`tier t${edge.tier}`} title={TIER_MEANING[edge.tier].label}>{edge.tier}</span>{' '}
                      {kindWords(edge.kind)} · <span className="mono">{readWarmth(edge).score}/5</span>
                      {tie.edges.length > 1 && <div className="muted">+{tie.edges.length - 1} more {tie.edges.length === 2 ? 'edge' : 'edges'}</div>}
                    </td>
                    <td className="through-evidence">
                      {edge.evidence.slice(0, 2).map((ev, ei) => (
                        <span key={ei}>
                          {ev.note}{' '}
                          {ev.source && (/^https?:\/\//.test(ev.source)
                            ? <a href={ev.source} target="_blank" rel="noreferrer">Source</a>
                            : <span className="muted">{ev.source}</span>)}
                          <span className="muted"> · {ev.as_of ? `recorded ${ev.as_of}` : `edge dated ${edge.validFrom.toISOString().slice(0, 10)}`}</span>
                        </span>
                      ))}
                      {edge.evidence.length === 0 && <span className="muted">No evidence note · edge dated {edge.validFrom.toISOString().slice(0, 10)}</span>}
                      <span className="muted">{tie.sources.join(', ')}</span>
                    </td>
                    <td>
                      {tie.combinedTier
                        ? <span className={`tier t${tie.combinedTier}`} title={TIER_MEANING[tie.combinedTier].label}>{tie.combinedTier}</span>
                        : <span className="tier none" title="No usable route to them on file">—</span>}{' '}
                      <span className="through-chain">{combinedWords(view, tie)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {view.onward.length > shown && (
          <nav className="route-more" aria-label="More onward ties">
            <Link href={moreHref(Math.min(view.onward.length, shown + 40))}>Show more ties (+{Math.min(40, view.onward.length - shown)})</Link>
          </nav>
        )}
        {view.restrictedOnward > 0 && (
          <p className="cover">{view.restrictedOnward} {view.restrictedOnward === 1 ? 'tie leads' : 'ties lead'} to someone with a restriction that applies here
            (do not approach, or not through {view.nodeName} or someone on our way to them). Not listed: the restriction attaches to them (rule 8).</p>
        )}
        <p className="cover">A route&rsquo;s tier is the weaker of its two parts: our best usable route to {view.nodeName}, and {view.nodeName}&rsquo;s tie to them.
          To ask, open &ldquo;Routes to&rdquo; for that person: the planner there checks every hop, ask load and restriction, and proposing stays its
          ordinary approval flow. Nothing here proposes or sends anything.</p>
      </div>

      <div className="card through-gaps" id="through-gaps">
        <div className="chead">
          <h2>Gaps in the records around {view.nodeName}</h2>
          <span className="lbl">for finding holes in the dataset</span>
        </div>
        <div className="cbody">
          {g.warnings.length > 0 ? (
            <ul className="through-warnings">
              {g.warnings.map((w) => <li key={w.key} data-warning={w.key}>{w.text}</li>)}
            </ul>
          ) : <p className="muted">No warning: edges from more than one source, above tier D.</p>}
          <div className="through-counts">
            <table className="list">
              <thead><tr><th>Source</th><th>Edges</th><th>Evidence dated</th><th>What it is</th></tr></thead>
              <tbody>
                {g.bySource.map((s) => (
                  <tr key={s.source}><td><b>{s.source}</b></td><td className="mono">{s.edges}</td>
                    <td className="mono">{s.from === s.to ? s.from : `${s.from} to ${s.to}`}</td><td className="muted">{SOURCE_MEANS[s.source]}</td></tr>
                ))}
                {g.bySource.length === 0 && <tr><td colSpan={4} className="muted">No source has an edge on {view.nodeName}.</td></tr>}
              </tbody>
            </table>
            <div className="through-side">
              <div className="lbl">By tier</div>
              <p className="mono">{(['A', 'B', 'C', 'D'] as const).map((t) => `${t} ${g.byTier[t]}`).join(' · ')}</p>
              <div className="lbl">By kind</div>
              <p className="mono">{g.byKind.length ? g.byKind.map((k) => `${kindWords(k.kind)} ${k.edges}`).join(' · ') : '—'}</p>
            </div>
          </div>
          <div className="lbl" style={{ marginTop: 12 }}>LPs reachable only through {view.nodeName}</div>
          {view.onlyThrough.length ? (
            <ul className="through-only">
              {view.onlyThrough.map((lp) => (
                <li key={lp.entityId}><Link href={hrefFor(lp.entityId, 'to')}>{lp.name}</Link>{' '}
                  <span className="muted">{lp.candidates ? `every one of ${lp.candidates} stored candidate ${lp.candidates === 1 ? 'path passes' : 'paths pass'} through ${view.nodeName}` : `no stored path of up to 3 hops; ${view.nodeName} is the only way in on file`}</span></li>
              ))}
            </ul>
          ) : <p className="muted">None among the LPs {view.nodeName} ties to.</p>}
          <p className="cover">
            Read from the stored route searches: {view.onlyThroughCoverage.cached} of the {view.onlyThroughCoverage.lps} LPs {view.nodeName} ties to have one
            {view.onlyThroughCoverage.computedFrom ? `, computed ${view.onlyThroughCoverage.computedFrom === view.onlyThroughCoverage.computedTo ? view.onlyThroughCoverage.computedFrom : `${view.onlyThroughCoverage.computedFrom} to ${view.onlyThroughCoverage.computedTo}`}` : ''}.
            {view.onlyThroughCoverage.checked < view.onlyThroughCoverage.lps && ` Only the first ${view.onlyThroughCoverage.checked} LPs, in the order above, were checked.`}
            {' '}Candidate paths are counted before restriction and organization-size checks. An LP with no stored search is not counted either way.
          </p>
        </div>
        <Coverage
          corpus={`${g.total} current relationship ${g.total === 1 ? 'edge' : 'edges'} and possible identity matches touching ${view.nodeName}${g.inspected < g.total ? `, ${g.inspected} inspected` : ''}`}
          from={g.bySource.length ? g.bySource.map((s) => s.from!).sort()[0]! : null}
          to={g.bySource.length ? g.bySource.map((s) => s.to!).sort().at(-1)! : null}
          notInspected={[]}
        />
        <p className="cover">Research candidates held as notes, and relationships nobody has recorded, are not edges and are not counted here.</p>
      </div>
    </>
  );
}
