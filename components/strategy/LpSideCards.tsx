import Link from '@/components/ui/AppLink';
import { routeReading, routeSummaryFor } from '@/components/routes/route-display';
import type { RouteSearch } from '@/modules/network';
import { affiliationsFor } from '@/modules/identity';
import { pipelineData } from '@/lib/pipeline-data';
import { STATUS_LABEL } from '@/modules/strategy';
import s from './lp-tables.module.css';

/**
 * Warm intro, on the LP page (issue 0093): how many ways in the network holds, how strong the best
 * ones read, and one clear way to the routes page for this LP. The same search the routes page runs
 * (team scope, three hops, this vehicle), so the two agree. A score is the network scorer's
 * uncalibrated estimate, never a probability; an unscored route says so.
 */
export function WarmIntroBox({ search, entityId }: { search: RouteSearch | null; entityId: string }) {
  const routes = (search?.routes ?? []).filter((r) => r.foldedUnder == null);
  const usable = routes.filter((r) => r.verdict === 'recommend');
  const summary = search ? routeSummaryFor(search) : null;
  const best = [...usable].sort((a, b) => routeReading(b).score - routeReading(a).score).slice(0, 3);
  const href = `/routes?target=${entityId}`;
  return (
    <div className={`card ${s.warm}`}>
      <div className={s.warmBody}>
        <div className="lbl">Warm intro</div>
        {!search ? (
          <p className={s.warmLede}>No route search could run: there is no team or PL record to start from.</p>
        ) : (
          <>
            <div className={s.warmCount}>
              <b>{usable.length.toLocaleString('en-US')}</b>
              <span>{usable.length === 1 ? 'possible connection' : 'possible connections'}{summary && summary.unavailable > 0 ? ` · ${summary.unavailable.toLocaleString('en-US')} held back` : ''}</span>
            </div>
            {summary && usable.length > 0 && (
              <div className={s.warmBands}>
                <span className={s.warmBand} data-band="strong"><i />{summary.strong} strong</span>
                <span className={s.warmBand} data-band="warm"><i />{summary.promising} promising</span>
                <span className={s.warmBand} data-band="weak"><i />{summary.weak} weak or unscored</span>
              </div>
            )}
            {best.length > 0 && (
              <ol className={s.warmList}>
                {best.map((route, i) => {
                  const reading = routeReading(route);
                  const via = route.hops.slice(0, -1).map((h) => h.toName);
                  return (
                    <li key={i}>
                      <span className={s.warmVia}>
                        {route.fromName ?? search.fromName}{via.length ? ` → ${via.join(' → ')}` : ''}
                        <small>{via.length ? `${via.length + 1} steps` : 'direct'} · tier {route.weakestTier}</small>
                      </span>
                      <span className={s.warmScore} title={reading.provisional ? 'Not scored by the network scorer' : 'Route strength: an uncalibrated estimate, not a probability'}>
                        {reading.provisional ? '—' : reading.score}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {usable.length === 0 && (
              <p className={s.warmLede}>No usable route in the {search.coverage.edges.toLocaleString('en-US')} relationship edges inspected. That is not the same as no route existing: the routes page can look further.</p>
            )}
          </>
        )}
        <Link className={`btn p ${s.warmCta}`} href={href}>Find a Warm Intro</Link>
        {usable.length > 0 && <p className={s.warmNote}>Route scores are the network scorer&rsquo;s estimates, 0–100, not chances. Opens this LP on the warm intro routes page.</p>}
      </div>
    </div>
  );
}

/**
 * The people of an organisation that is the LP (issue 0092): who is on record there, and which of
 * them we are pursuing in this vehicle, with their status and score. Each opens their own page.
 */
export async function OrgPeople({ orgId, orgName, vehicleId, currentPursuitId }: {
  orgId: string; orgName: string; vehicleId: string; currentPursuitId: string;
}) {
  const [affiliations, pipeline] = await Promise.all([affiliationsFor([orgId], 400), pipelineData(vehicleId)]);
  const people = [...new Map(affiliations.filter((a) => a.orgId === orgId && !a.endedOn).map((a) => [a.personId, a])).values()];
  const pursued = new Map(pipeline.rows.filter((r) => !r.isOrg).map((r) => [r.entityId, r]));
  const list = people
    .map((a) => ({ a, p: pursued.get(a.personId) ?? null }))
    .sort((x, y) => Number(Boolean(y.p)) - Number(Boolean(x.p)) || (y.p?.score ?? -1) - (x.p?.score ?? -1) || x.a.personName.localeCompare(y.a.personName));
  if (!list.length) return null;
  const SHOWN = 12;
  const pursuedCount = list.filter((x) => x.p).length;
  return (
    <div className="card">
      <div className="chead">
        <h2>People at {orgName}</h2>
        <span className="lbl">{list.length} on record · {pursuedCount} pursued</span>
      </div>
      <ul className={s.orgPeople}>
        {list.slice(0, SHOWN).map(({ a, p }) => (
          <li key={a.personId} className={p?.id === currentPursuitId ? s.here : undefined}>
            <span>
              {p ? <Link href={`/targets/${p.id}`}>{a.personName}</Link> : <Link href={`/orgs/${a.personId}`}>{a.personName}</Link>}
              {a.role && <small>{a.role}</small>}
            </span>
            <span className={s.orgPeopleStatus}>
              {p ? <>{STATUS_LABEL[p.status]}{p.score !== null && <b>{p.score}</b>}</> : <span className="muted">not pursued</span>}
              {p?.id === currentPursuitId && <small>this page</small>}
            </span>
          </li>
        ))}
      </ul>
      {list.length > SHOWN && (
        <div className={s.orgPeopleMore}><Link href={`/orgs/${orgId}`}>All {list.length} people at {orgName}</Link></div>
      )}
    </div>
  );
}
