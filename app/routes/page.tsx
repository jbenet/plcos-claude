import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { RouteGraph } from '@/components/routes/RouteGraph';
import { ProposeButton } from '@/components/routes/ProposeButton';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { listEntities } from '@/modules/identity';
import { listSourceDocs } from '@/modules/research';
import { listVehicles } from '@/modules/platform';
import { planRoutes, tierCounts, TIER_MEANING, VERDICT_LABEL, type EvidenceTier } from '@/modules/network';

export const dynamic = 'force-dynamic';

const VERDICT_FLAG: Record<string, string> = {
  recommend: 'f-ok', hold: 'f-ev', not_a_route: 'f-mute', excluded: 'f-block',
};

const TIERS: EvidenceTier[] = ['A', 'B', 'C', 'D'];

export default async function Routes({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; r?: string }>;
}) {
  const selection = await vehicleSelection();
  const { target, r } = await searchParams;
  const user = await (await auth()).currentUser();
  const [entities, docs, tiers, vehicles] = await Promise.all([
    listEntities(), listSourceDocs(), tierCounts(), listVehicles(),
  ]);

  // Targets worth showing: everyone who is not a member of the team.
  const teamNames = new Set(['Juan', 'Mara Vance', 'Sam Ferreira', 'Inés Duarte', 'Tomás Reyes']);
  const targets = entities.filter((e) => !teamNames.has(e.displayName));
  const targetId = target ?? targets.find((t) => t.displayName === 'Delia Roos')?.entityId ?? targets[0]?.entityId;
  const search = targetId ? await planRoutes(user.handle, targetId) : null;
  const selected = Math.min(Math.max(0, Number(r ?? 0)), Math.max(0, (search?.routes.length ?? 1) - 1));

  const docMap = new Map<string, EvidenceDoc>(
    docs.map((d) => [
      d.docId,
      { docId: d.docId, title: d.title, origin: d.origin, asOf: shortDate(d.asOf), strength: d.strength, supports: d.supports },
    ]),
  );

  return (
    <Page
      crumbs={moduleCrumbs('routes', selection.current?.name ?? null)}
      queue={
        <>
          <div className="qhead">
            <div className="lbl">Module 05 · route to whom</div>
            <h2>{targets.length} in the universe</h2>
            <p>
              Routes are computed from {user.name}. Switching user in the rail changes every
              answer on this page, because the graph is asymmetric.
            </p>
          </div>
          {targets.map((t) => (
            <Link
              key={t.entityId}
              href={`/routes?target=${t.entityId}`}
              className={`tix${t.entityId === targetId ? ' on' : ''}`}
            >
              <b>{t.displayName}</b>
              <p>{t.entityType}</p>
            </Link>
          ))}
        </>
      }
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
      <div className="lbl">Module 05 · Discover &amp; qualify</div>
      <h1>Routes to {search?.targetName ?? '—'}</h1>
      <p className="sublede">
        Ranked by what the evidence can actually carry, from {search?.fromName ?? user.name}. A
        route is only as good as its worst hop, a tier C or D hop that nobody has confirmed cannot
        carry a route at all, and a restriction on the target excludes every path through the
        restricted party rather than one.
      </p>

      {!search || search.routes.length === 0 ? (
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
                No path from {search?.fromName ?? user.name} to {search?.targetName ?? 'this target'} exists in
                the material available.
              </h3>
              <p>
                That is not the same as &ldquo;no route exists&rdquo;. It means the edges on file do not
                connect you within {search?.coverage.maxHops ?? 3} hops. Someone else on the team may
                have a path — switch user in the rail and this page recomputes.
              </p>
              <dl>
                <dt>What is known</dt>
                <dd>
                  {search?.coverage.edges ?? 0} edges inspected, up to {search?.coverage.maxHops ?? 3} hops.
                </dd>
                <dt>Who can act</dt>
                <dd>Anyone who knows of a relationship we have not recorded.</dd>
                <dt>Safe next step</dt>
                <dd>Record the edge with its evidence, or approach directly and say so.</dd>
              </dl>
            </div>
          </div>
          {search && (
            <Coverage
              corpus={`${search.coverage.edges} relationship edges, up to ${search.coverage.maxHops} hops`}
              from={search.coverage.from ? shortDate(search.coverage.from) : null}
              to={search.coverage.to ? shortDate(search.coverage.to) : null}
              notInspected={search.coverage.notInspected}
            />
          )}
        </div>
      ) : (
        <>
          <div className="card">
            <div className="chead">
              <h2>Routes in</h2>
              <span className="lbl">
                {search.routes.length} path{search.routes.length === 1 ? '' : 's'} · ranked by evidence, then hops
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
                  {(route.verdict === 'recommend' || route.verdict === 'hold') && (
                    <ProposeButton
                      targetId={search.targetId}
                      connectorId={route.connectorIds[route.connectorIds.length - 1] ?? null}
                      vehicles={vehicles.filter((v) => v.kind !== 'grant_rail').map((v) => ({ slug: v.slug, name: v.name }))}
                    />
                  )}
                </div>
                <div className="verdict">
                  <b className={route.verdict === 'excluded' || route.verdict === 'not_a_route' ? 'stop' : ''}>
                    {VERDICT_LABEL[route.verdict]}
                  </b>
                  {route.askLoad ? (
                    <>
                      {route.askLoad.used} of {route.askLoad.cap} asks
                      <br />
                      used this quarter
                    </>
                  ) : (
                    'direct'
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
    </Page>
  );
}
