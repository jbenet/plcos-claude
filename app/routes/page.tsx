import { AuthorizedControl } from '@/lib/authz/read/Control';
import { config } from '@/config/deployment';
import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { EmailDrafts } from '@/components/email/EmailDrafts';
import { OutreachContext } from '@/components/outreach/OutreachContext';
import { RouteNames } from '@/components/routes/RouteNames';
import { ConnectionFeedback } from '@/components/routes/ConnectionFeedback';
import { RouteGraph } from '@/components/routes/RouteGraph';
import { ProposeButton } from '@/components/routes/ProposeButton';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { Glyph } from '@/components/ui/Glyph';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { listEntities, affiliationsFor } from '@/lib/authz/read/identity';
import { TargetPicker } from '@/components/routes/TargetPicker';
import { listSourceDocs, notesFor } from '@/lib/authz/read/research';
import { directContact, type DirectContact } from '@/modules/meetings';
import { planRoutes, warmthReader, tieWarmth, TIER_MEANING, VERDICT_LABEL, type EvidenceTier, type Route } from '@/lib/authz/read/network';
import type { Path } from '@/lib/enrich/connect';
import { buildNetworkAction } from './actions';
import { routeInputs, promotedRouteBases, graphRouteInputs, routeComparisonInputs } from '@/lib/authz/read/routes';
import { RouteSections } from '@/components/routes/RouteSections';
import { RouteFilters } from '@/components/routes/RouteFilters';
import { routeReading, routeSummaryFor } from '@/components/routes/route-display';
import { ThroughMap, ThroughSections } from '@/components/routes/ThroughSections';
import type { TargetRow } from '@/components/routes/TargetPicker';
import { routeSources, throughNode } from '@/lib/authz/read/network';
import { searchEntities } from '@/lib/authz/read/identity';

export const dynamic = 'force-dynamic';

const TIERS: EvidenceTier[] = ['A', 'B', 'C', 'D'];

/** "Met 12 Mar 2026", "Heard from Elif Ruiz, 3 Jun 2026": the latest direct contact, in words. */
const touchWords = (c: DirectContact) => c.via
  ? `${c.how === 'met' ? 'Met' : 'Heard from'} ${c.via}, ${shortDate(c.on)}`
  : `${c.how === 'met' ? 'Met' : 'Heard from them'} ${shortDate(c.on)}`;

/** A path the research found near a target (docs/19, W3): a candidate for a person to check, never a route. */
type CandidatePath = Path;
const OTHER_LABEL: Record<CandidatePath['other']['type'], string> = {
  team: 'on the team', ours: 'one of ours', backer: 'a backer of ours', lp: 'another LP',
};

async function Routes({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; r?: string; q?: string; sort?: string; min?: string; touch?: string; expanded?: string; page?: string; family?: string; exclude?: string; prefer?: string; warmth?: string; show?: string; removedPage?: string; mode?: string; tshow?: string }>;
}) {
  const selection = await vehicleSelection();
  const params = await searchParams;
  const { target, r, q = '', sort: sortParam, min: minParam, touch: touchParam, expanded, page, family } = params;
  // "Routes through X" (Juan, 2 Oct 2026): the same page, toggled in the address, so any state links.
  const through = params.mode === 'through';
  const user = await (await auth()).currentUser();
  const { tiers, vehicles, affiliations: pickerAffiliations, fit, asks, team, entities: pipelineEntities, targets, contact, rows: pipelineRows, founders } =
    await routeInputs(selection.current?.id ?? '');
  // The server searches the targets (issue 0023): the page carries only the rows it draws.
  const SHOWN = 80;
  const sort: 'score' | 'name' = sortParam === 'name' ? 'name' : 'score';
  const minScore = [60, 75].includes(Number(minParam)) ? Number(minParam) : 0;
  const needle = q.trim().toLowerCase();
  const touchShown = touchParam === '1';
  // Through mode picks any node: our route sources first, the pipeline, then anyone the search names.
  const plainRow = (entityId: string, name: string, isPerson: boolean, lpType: string): TargetRow => ({ entityId, name, isPerson, lpType,
    lpIcon: isPerson ? 'person' : 'folder', score: null, provisional: false, borrowedFrom: null, related: [], blocker: null, touch: null, signals: [] });
  const sourceRows = through ? (await routeSources()).map((s) => plainRow(s.entityId, s.name, !s.sourceOnly, s.sourceOnly ? 'PL organization' : 'Team or PL staff')) : [];
  const searchRows = through && needle ? (await searchEntities(q, 40)).map((e) => plainRow(e.entityId, e.displayName, e.entityType === 'person', e.entityType)) : [];
  const listed = new Set<string>();
  const rows = through
    ? [...sourceRows, ...pipelineRows, ...searchRows].filter((row) => !listed.has(row.entityId) && Boolean(listed.add(row.entityId)))
    : pipelineRows;
  const sourceIds = new Set(sourceRows.map((s) => s.entityId));
  const matching = rows
    .filter((t) => (minScore ? (t.score ?? -1) >= minScore : true))
    .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.related.some((x) => x.toLowerCase().includes(needle)));
  // In touch already: left out unless asked for, and counted, so none is dropped without a word.
  const hiddenInTouch = touchShown ? 0 : matching.filter((t) => t.touch).length;
  const matched = (touchShown ? matching : matching.filter((t) => !t.touch))
    .sort((a, b) => Number(sourceIds.has(b.entityId)) - Number(sourceIds.has(a.entityId))
      || (sort === 'name' ? a.name.localeCompare(b.name) : (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name)));
  const shown = matched.slice(0, SHOWN);
  const entities = target && !pipelineEntities.some((e) => e.entityId === target)
    ? [...pipelineEntities, ...await listEntities([target])] : pipelineEntities;
  // Through mode opens on the picker: no node is chosen for you, so nothing heavy runs until one is.
  const targetId = target ?? (through ? undefined : matched[0]?.entityId);
  const ownAffiliations = targetId ? await affiliationsFor([targetId]) : [];
  const firmIds = ownAffiliations.filter(a => a.current && a.personId === targetId).map(a => a.orgId);
  const firmAffiliations = firmIds.length ? await affiliationsFor(firmIds) : [];
  const affiliations = [...new Map([...pickerAffiliations, ...ownAffiliations, ...firmAffiliations].map(a => [a.affiliationId, a])).values()];
  const minimumWarmth = [1, 2, 3, 4].includes(Number(params.warmth)) ? Number(params.warmth) : 0;
  const preferred = (route: Route) => route.hops.some((h) => {
    if (params.prefer === 'coinvestor') return h.edge.kind === 'coinvestor';
    if (params.prefer === 'family') return h.edge.kind === 'family';
    if (params.prefer === 'cofounder') return h.edge.evidence.some((e) => e.tie?.kind === 'cofounder');
    // Match explicit relationship records, never names or guessed proximity.
    if (params.prefer === 'our_investor' && h.edge.evidence.some((e) => (e.tie as { withUs?: string } | undefined)?.withUs === 'investor')) return true;
    const kinds: Record<string, string> = { our_investor: 'they_lp_in_us', existing_lp: 'they_lp_in_us', friend: 'personal' };
    return Boolean(kinds[params.prefer ?? ''] && fit.some((a) => route.connectorIds.includes(a.entityId)
      && a.links.some((l) => l.kind === kinds[params.prefer!] && (params.prefer !== 'friend' || (/friend/i.test(l.statement) && l.viaEntityId != null && [h.edge.fromEntity, h.edge.toEntity].includes(l.viaEntityId))))));
  });
  const search = targetId
    ? await planRoutes(user.handle, targetId, 3, selection.current?.kind ?? 'fund', 'team', undefined, {
      vehicleId: selection.current?.id, exclude: params.exclude, minimumWarmth, preferred: params.prefer ? preferred : undefined,
    })
    : null;

  const removedPageCount = Math.ceil((search?.removedRoutes?.length ?? 0) / 50);
  const removedPage = /^\d+$/.test(params.removedPage ?? '') ? Math.min(Number(params.removedPage), Math.max(0, removedPageCount - 1)) : 0;
  const removedRows = search?.removedRoutes?.slice(removedPage * 50, (removedPage + 1) * 50) ?? [];
  const readWarmth = warmthReader();
  const allRoutes = search?.routes ?? [];
  const routeSummary = search ? { ...routeSummaryFor(search),
    ...(search.candidateCounts ? { unavailable: search.candidateCounts.unavailable } : {}) } : null;
  const intermediates = [...new Map(allRoutes.flatMap((route) => route.hops.slice(0, -1).map((h) => [h.toEntity, { id: h.toEntity, name: h.toName }] as const))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const { eligible, familyId, show, pageNumber, displayedRoutes, selected, alternatives } = routeComparisonInputs(allRoutes, {
    expanded, family, selected: r, show: params.show, page, exclude: params.exclude, minimumWarmth,
    lastWarmth: (route) => route.hops.length ? readWarmth(route.hops.at(-1)!.edge).score : 0,
    preferred: (route) => Boolean(params.prefer) && preferred(route),
  });
  const routeHref = (changes: Record<string, string | undefined>) => {
    const values = { ...params, target: targetId, ...changes };
    const query = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined));
    return `/routes?${query}`;
  };
  // Toggling keeps the node and the filters; a node link from the through view starts that node fresh.
  const modeHref = (mode: 'to' | 'through') => routeHref({ mode: mode === 'through' ? 'through' : undefined, r: undefined, tshow: undefined });
  const nodeHref = (id: string, mode: 'to' | 'through') => routeHref({ target: id, mode: mode === 'through' ? 'through' : undefined,
    r: undefined, page: undefined, family: undefined, show: undefined, exclude: undefined, tshow: undefined, removedPage: undefined });
  const throughShown = /^\d+$/.test(params.tshow ?? '') ? Math.max(40, Math.min(1000, Number(params.tshow))) : 40;
  // A slow or failed through view never takes the page down: the routes-to sections still render,
  // with a note in its place. GUESS: 8 s is past every measured node (PL itself, ~167K edges).
  let throughFailed = false;
  const throughView = through && targetId ? await Promise.race([
    throughNode(targetId, { routesToNode: search?.routes ?? [], vehicleId: selection.current?.id, vehicleKind: selection.current?.kind ?? 'fund' }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('through view over budget')), 8000).unref()),
  ]).catch((error: unknown) => { throughFailed = true; console.error('[routes through]', error instanceof Error ? error.message : error); return null; }) : null;
  const ours = throughView?.source ?? null;

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
    targetId ? notesFor(targetId, 'connection_candidates', 1).then((n) => n[0] ?? null) : Promise.resolve(null),
    directContact([...nearbyPeople.keys()]),
  ]);
  const promotedBases = promotedRouteBases(search?.routes ?? [], search?.promotedBasisHashes);
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
      queue={<TargetPicker targets={shown} current={targetId} matched={matched.length} total={rows.length} q={q} sort={sort} min={minScore} touchShown={touchShown} hiddenInTouch={hiddenInTouch} firstShown={Math.min(matched.length, SHOWN)} through={through} />}
      inspector={
        <>
          <div className="lbl">Evidence tiers</div>
          <div className="ihead">What each tier may carry</div>
          <div className="imeta">A–D on every edge · uncertainty stays visible</div>
          {TIERS.map((t) => {

            return (
              <div key={t} style={{ padding: '10px 0', borderBottom: '1px solid var(--hair)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`tier t${t}`}>{t}</span>
                  <b style={{ fontSize: 12.5, fontWeight: 500 }}>{TIER_MEANING[t].label}</b>

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

        </>
      }
    >
      <RouteSections>
      <div className="lbl">Module 05 · Warm intro routes</div>
      <nav className="route-mode" aria-label="Route view">
        <Link href={modeHref('to')} className={through ? '' : 'on'} aria-current={through ? undefined : 'page'}>Routes to</Link>
        <Link href={modeHref('through')} className={through ? 'on' : ''} aria-current={through ? 'page' : undefined}>Routes through</Link>
      </nav>
      <h1>{through ? 'Routes through' : 'Routes to'} {targetName ?? (through ? 'anyone' : '—')}</h1>
      <p className="routes-lede">{through
        ? <>Our routes to them, and who they could introduce us to beyond · a tie on file is not an offer to introduce · asks and sends need separate approval.</>
        : <>Team and PL routes · estimates carry uncertainty · asks and sends need separate approval.</>}</p>
      {(pickerAffiliations.length === 2000 || ownAffiliations.length === 2000 || firmAffiliations.length === 2000) && <p className="cover">Showing the first 2,000 affiliations per selected group. Other colleagues may not have been inspected.</p>}
      {through && !targetId ? (
        <div className="card" data-through-empty>
          <div className="chead"><h2>Pick someone to look through</h2><span className="lbl">nothing is chosen for you</span></div>
          <div className="cbody">
            <p>Choose anyone on the left: a teammate or PL, an LP, a connector, or search for any person or organization by name.
              The page then shows our routes to them, who they could introduce us to, and the gaps in the records around them.</p>
          </div>
        </div>
      ) : ours ? (
        <p className="intouch">
          <Glyph name="check" title="One of ours" tone="good" />
          <span><b>{targetName} is one of our route sources</b> ({ours.kind === 'pl' ? 'the PL organization' : 'team or PL staff'}). Routes start here, so
            there is no route to them; below is everyone they tie to.</span>
        </p>
      ) : (<>
      {search?.ruleCounts && <details id="route-checks" className="card route-aux" open={params.removedPage !== undefined}>
        <summary>Route checks · {search.ruleCounts.restricted} removed for restrictions · {search.ruleCounts.largeOrganizations} organization hub paths removed</summary>
        <div className="cbody">
          <p>{search.ruleCounts.inspected} candidate paths inspected before these checks. {search.ruleCounts.sourcePrefixes} team prefixes shortened; {search.ruleCounts.duplicates} duplicates removed; {search.ruleCounts.repeatedPeople} repeated-person paths removed; {search.ruleCounts.plFallbacks} redundant PL fallback paths removed. {search.ruleCounts.organizationPenalties} remaining organization paths scored down by size.</p>
          <p>Team members start their own routes. PL supplies access only where no particular team member is known. Same-name and possible-match records share one map node and are checked conservatively; their identities and evidence remain separate in the list. Restrictions apply to every person in a path and to the selected vehicle. Organization hops stop at {config.routePolicy.maxOrganizationMembers} known graph members or {config.routePolicy.maxOrganizationHeadcount} recorded employees; these limits are estimates.</p>
          {Boolean(removedRows.length) && <ul>{removedRows.map((removed, i) => <li key={i}>
            {removed.fromName} → {removed.names.join(' → ')} — {removed.reason === 'restricted'
              ? 'Removed: a person in this path has a do-not-contact instruction. The instruction must be respected.'
              : 'Removed: an organization in this path exceeds the configured graph-member or public headcount limit.'}
          </li>)}</ul>}
          {removedPageCount > 1 && <nav aria-label="Removed route pages">
            <span>Page {removedPage + 1} of {removedPageCount} · {search.removedRoutes!.length} removed paths </span>
            {removedPage > 0 && <Link href={`${routeHref({ removedPage: String(removedPage - 1) })}#route-checks`}>Previous removed paths</Link>}
            {' '}{removedPage + 1 < removedPageCount && <Link href={`${routeHref({ removedPage: String(removedPage + 1) })}#route-checks`}>Next removed paths</Link>}
          </nav>}
        </div>
      </details>}

      {routeSummary && <section className="route-stats" aria-label="Route strength summary">
        <div><strong>{routeSummary.strong}</strong><span>Strong</span></div>
        <div><strong>{routeSummary.promising}</strong><span>Promising</span></div>
        <div><strong>{routeSummary.weak}</strong><span>Weak</span></div>
        <div><strong>{routeSummary.unavailable}</strong><span>Held / unavailable</span></div>
        <div className="route-confidence"><b>{routeSummary.confidence}</b><p>{routeSummary.basis}</p><small>Before filters · {search?.candidateCounts?.total ?? allRoutes.length} paths recorded</small></div>
      </section>}

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
                <dd>An administrator: building the network links each of the team to a person record and makes the ties our records show — recent direct contact is grade B — and those the research found, C and D labelled as weaker evidence.</dd>
                <dt>Safe next step</dt>
                <dd>Build it below. Where the team is in touch already, approach directly and say so.</dd>
              </dl>
              <AuthorizedControl action="admin"><form action={buildNetworkAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="target" value={targetId ?? ''} />
                <button className="btn p" type="submit">Build the network from our records and the research</button>
              </form></AuthorizedControl>
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
          <RouteFilters intermediates={intermediates} />
          {familyId !== null && <p className="routes-lede">Viewing one route family · <Link href={routeHref({ family: undefined, page: undefined, r: undefined, show: undefined })}>Back to ranked routes</Link></p>}
          {params.prefer && <p className="routes-lede">{eligible.filter((x) => preferred(x.route)).length} routes match the preferred relationship in the available records. Other routes remain below them.</p>}
          {!through && <details className="card route-graph-section" open>
            <summary>Route map <span className="muted">· {displayedRoutes.length} paths · one node per person</span></summary>
            <RouteGraph routes={graphRouteInputs(displayedRoutes.map(({ route }) => route))} fromName={search.fromName} targetName={search.targetName}
              portfolioFounders={founders}
              selected={Math.max(0, displayedRoutes.findIndex(({ index }) => index === selected))} routeIds={displayedRoutes.map((x) => x.index)} />
          </details>}
          {throughView && <ThroughMap view={throughView} routesIn={displayedRoutes.map((x) => x.route)} routeIds={displayedRoutes.map((x) => x.index)} founders={founders} />}
          <div className="card route-comparison">
            <div className="chead"><h2>{through ? `Our routes to ${search.targetName}` : 'Compare routes'}</h2><span className="lbl">{displayedRoutes.length} shown · {eligible.length} match</span></div>
            <p className="route-comparison-key">Matching identity records share one map node; the list retains each record’s evidence. Route score /100 · every hop’s grade · weakest hop /5 · open a row for evidence and actions</p>
            {displayedRoutes.length === 0 && <p className="cbody">No recorded routes match these filters. Clear the excluded intermediate or lower the warmth minimum to inspect the available material.</p>}
            {displayedRoutes.map(({ route, index: i }) => (
              <details key={i} id={`route-${i}`} className="route-detail" open={r === String(i)}>
                <summary className="route-comparison-row">
                  <span className="route-score" title={routeReading(route).provisional ? 'Provisional influence / tier estimate; not probability' : 'Route strength'}>{routeReading(route).provisional ? '—' : routeReading(route).score}</span>
                  <span className="route-chain">{route.fromName ?? search.fromName} → {route.hops.map((h) => h.toName + (founders[h.toEntity] ? ' (PLC portfolio founder)' : '')).join(' → ')}{route.viaContact && ` · via ${route.viaContact.role} for ${search.targetName}`}</span>
                  <span className="route-hop-grades" title="Grades in hop order">{route.hops.map(h=>h.edge.tier).join(" ")}</span>
                  <span className="mono">{route.hops.length ? Math.min(...route.hops.map(h=>readWarmth(h.edge).score)) : '—'}/5</span>
                  <span className="route-row-verdict">{VERDICT_LABEL[route.verdict]}</span>
                </summary>
              <div className={`route${i === selected ? ' best' : ''}`}>
                <span className="route-hop-grades" title="Grades in hop order">{route.hops.map(h=>h.edge.tier).join(" ")}</span>
                <div className="rt">
                  <RouteNames route={route} alternatives={(alternatives.get(i) ?? []).map((x) => x.route)} fromName={route.fromName ?? search.fromName} />
                  <div><Link href={routeHref({ r: String(i) })}>Inspect this route</Link></div>
                  {route.hops.map((h) => (
                    <div key={h.edge.edgeId}>
                      <p style={{ marginBottom: 3 }}>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                          <b>{readWarmth(h.edge).score}/5</b> · grade {h.edge.tier} · {h.edge.kind.replace('_', ' ')} · edge dated {h.edge.validFrom.getFullYear()}
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
                  {expanded !== '1' && !family && alternatives.has(i) && (
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
                      {route.askLoad.busy && (
                        <div><span className="flag f-ev" title="Asked at or past the guide this quarter. A warning only: nothing is held.">busy introducer</span></div>
                      )}
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
                  {routeReading(route).factors.length > 0 && <div className="infl">
                    <div className="inflhead"><span className="lbl">{routeReading(route).provisional ? 'Provisional influence factors' : 'Route score factors'}</span><span className="inflscore">{routeReading(route).score}</span></div>
                    <table className="inflt"><tbody>{routeReading(route).factors.map((f, index) => <tr key={index}><th scope="row">{f.label} <span className="mono">{f.value}</span></th><td className="iwhy">{f.basis}</td></tr>)}</tbody></table>
                    {route.influence && <p className="theask"><b>The ask to make.</b> {route.influence.theAsk}</p>}
                  </div>}
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
                  {/* The intro ask itself, as an email to the first connector, moved to the person's own Gmail (docs/25). */}
                  {i === selected && route.connectorIds[0] && (route.verdict === 'recommend' || route.verdict === 'hold') && (selection.current && selection.current.kind !== 'grant_rail' ? (
                    <>
                    <OutreachContext entityId={search.targetId} vehicleId={selection.current.id} connectorId={route.connectorIds[0]} connectorName={route.connectorNames[0] ?? null} />
                    <EmailDrafts
                      title="Intro ask email"
                      lede={`Write to ${route.connectorNames[0]} asking for an introduction to ${search.targetName}, for ${selection.current.name}. Sending it is the ask. No approval is needed; check the outreach context above before you send.`}
                      where={{ entityId: search.targetId, connectorId: route.connectorIds[0], vehicleId: selection.current.id }}
                      create={{ purpose: 'intro_ask', vehicleId: selection.current.id, entityId: search.targetId, connectorId: route.connectorIds[0] }}
                      path="/routes"
                      startLabel={`Draft the intro ask to ${route.connectorNames[0]}`}
                    />
                    </>
                  ) : <p className="muted" style={{ fontSize: 12 }}>Pick a fund or SPV in the vehicle switcher to draft the intro ask as an email.</p>)}
                </div>
              </div>
              </details>
            ))}
            <nav className="route-more" aria-label="More routes">
              {show < 80 && pageNumber * 80 + displayedRoutes.length < eligible.length && <Link href={routeHref({ show: String(show + 8), r: undefined })}>Show more routes (+{Math.min(8, eligible.length - pageNumber * 80 - show)})</Link>}
              {show > 8 && <Link href={routeHref({ show: '8', r: undefined })}>Show fewer</Link>}
              {pageNumber > 0 && <Link href={routeHref({ page: String(pageNumber - 1), r: undefined })}>Previous routes</Link>}
              {show === 80 && (pageNumber + 1) * 80 < eligible.length && <Link href={routeHref({ page: String(pageNumber + 1), r: undefined })}>Next routes</Link>}
            </nav>
            <Coverage
              corpus={`${search.coverage.edges} relationship edges, up to ${search.coverage.maxHops} hops`}
              from={search.coverage.from ? shortDate(search.coverage.from) : null}
              to={search.coverage.to ? shortDate(search.coverage.to) : null}
              notInspected={search.coverage.notInspected}
            />
          </div>

        </>
      )}
      </>)}

      {throughFailed && (
        <div className="card warn" data-section-failed="through">
          <div className="cbody">
            <p><b>The through sections did not finish.</b> Our routes to {targetName ?? 'them'} above are complete. Who they could introduce
              us to and the gaps panel took too long or failed this time; reload the page to try again.</p>
          </div>
        </div>
      )}
      {throughView && <>
        {(ours || !search || search.routes.length === 0) && <ThroughMap view={throughView} routesIn={[]} routeIds={[]} founders={founders} />}
        <ThroughSections view={throughView} hrefFor={nodeHref} shown={throughShown}
          moreHref={(n) => `${routeHref({ tshow: String(n), r: undefined })}#through-onward`} />
      </>}

      {targetId && <details className="card route-aux"><summary>Connection feedback</summary><ConnectionFeedback key={targetId} lp={targetId} /></details>}

      {candidates.length > 0 && (
        <details className="card nearcard route-aux">
          <summary>Near them, from the research · {candidates.length} candidate {candidates.length === 1 ? 'path' : 'paths'}</summary>
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
        </details>
      )}

      {inTouchNearby.length > 0 && (
        <details className="card nearcard route-aux">
          <summary>{isPerson ? 'At their firm, in touch with the team' : 'There, in touch with the team'} · {inTouchNearby.length} people</summary>
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
        </details>
      )}
      </RouteSections>
    </Page>
  );
}

export default coalescePage('/routes', Routes);
