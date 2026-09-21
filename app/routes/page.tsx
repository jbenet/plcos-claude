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
import { listAffiliations, listEntities } from '@/modules/identity';
import { listAsks } from '@/modules/coordination';
import { listAssessments, BLOCKER_SHORT } from '@/modules/fit';
import { TargetPicker, type TargetRow } from '@/components/routes/TargetPicker';
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
  const [entities, docs, tiers, vehicles, affiliations, fit, asks, team] = await Promise.all([
    listEntities(), listSourceDocs(), tierCounts(), listVehicles(),
    listAffiliations(), listAssessments(selection.current?.id ?? null),
    listAsks(null), (await auth()).listUsers(),
  ]);

  // Targets worth showing: everyone who is not a member of the team.
  const teamNames = new Set(['Juan', 'Mara Vance', 'Sam Ferreira', 'Inés Duarte', 'Tomás Reyes']);
  const targets = entities.filter((e) => !teamNames.has(e.displayName));
  const targetId = target ?? targets.find((t) => t.displayName === 'Delia Roos')?.entityId ?? targets[0]?.entityId;
  const search = targetId
    ? await planRoutes(user.handle, targetId, 3, selection.current?.kind ?? 'fund')
    : null;

  /**
   * The picker carries the fit score, because there is no point finding a beautiful route
   * to somebody nobody has qualified — and the records around each name, so searching
   * "Kaplan" turns up the trust and the person who signs for it.
   */
  const best = new Map<string, { score: number; blocker: string }>();
  for (const a of fit) {
    const hit = best.get(a.entityId);
    const score = Math.round(a.weightedFit * 100);
    if (!hit || score > hit.score) {
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
      borrowedFrom: borrowedFrom?.org ?? null,
      blocker: reading?.blocker ?? null,
      related: [...new Set(related)].slice(0, 3),
    };
  });
  const selected = Math.min(Math.max(0, Number(r ?? 0)), Math.max(0, (search?.routes.length ?? 1) - 1));

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
      queue={<TargetPicker targets={rows} current={targetId} total={targets.length} />}
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
      <h1>Routes to {search?.targetName ?? '—'}</h1>
      <p className="sublede">
        Two questions, answered in order. <b>May this route be used?</b> — a route is only as good
        as its worst hop, an unconfirmed tier C or D hop cannot carry one at all, and a restriction
        on the target excludes every path through the restricted party. Then, among the routes that
        may be used: <b>how much weight does it actually carry?</b>
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
