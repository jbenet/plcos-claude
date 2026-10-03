import Link from '@/components/ui/AppLink';
import { routeReading, routeSummaryFor } from '@/components/routes/route-display';
import type { RouteSearch } from '@/lib/authz/read/network';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { STATUS_LABEL } from '@/lib/authz/read/strategy';
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
        <p className={s.warmNote}><Link href={`${href}&mode=through`}>Routes through them</Link>: who they could introduce us to, and the gaps in their records.</p>
        {usable.length > 0 && <p className={s.warmNote}>Route scores are the network scorer&rsquo;s estimates, 0–100, not chances. Opens this LP on the warm intro routes page.</p>}
      </div>
    </div>
  );
}

/**
 * The people of an organisation that is the LP (issues 0092, 0111; docs/23): its contacts on this
 * pursuit first — the people a re-pointed pursuit came from — then everyone on record there. Anyone
 * who also invests in their own capacity has an individual LP row here, linked with its status.
 */
export async function OrgPeople({ orgId, orgName, vehicleId, currentPursuitId }: {
  orgId: string; orgName: string; vehicleId: string; currentPursuitId: string;
}) {
  const pipeline = await pipelineData(vehicleId);
  const byId = new Map(pipeline.rows.map((r) => [r.id, r]));
  const list = byId.get(currentPursuitId)?.people ?? [];
  if (!list.length) return null;
  const SHOWN = 12;
  const contacts = list.filter((p) => p.contact).length, individuals = list.filter((p) => p.individual).length;
  return (
    <div className="card">
      <div className="chead">
        <h2>People at {orgName}</h2>
        <span className="lbl">{list.length} on record{contacts ? ` · ${contacts} ${contacts === 1 ? 'contact' : 'contacts'} here` : ''}{individuals ? ` · ${individuals} also individual` : ''}</span>
      </div>
      <ul className={s.orgPeople}>
        {list.slice(0, SHOWN).map((p) => {
          const own = p.individual ? byId.get(p.individual) ?? null : null;
          return (
            <li key={p.id}>
              <span>
                <Link href={`/orgs/${p.id}`}>{p.name}</Link>
                <small>{[p.role, p.contact ? 'a contact on this LP' : null].filter(Boolean).join(' · ') || 'at the organisation'}</small>
              </span>
              <span className={s.orgPeopleStatus}>
                {own ? <><Link href={`/targets/${own.id}`}>Individual LP</Link> · {STATUS_LABEL[own.status]}{own.score !== null && <b>{own.score}</b>}</>
                  : <span className="muted">{p.contact ? 'contact' : 'not an LP here'}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {list.length > SHOWN && (
        <div className={s.orgPeopleMore}><Link href={`/orgs/${orgId}`}>All {list.length} people at {orgName}</Link></div>
      )}
    </div>
  );
}
