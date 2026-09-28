import { vehicleSelection } from '@/lib/session';
import Link from '@/components/ui/AppLink';
import { currentUser } from '@/lib/auth';
import { can, type Principal } from '@/lib/authz';
import { listVehicles } from '@/modules/platform';
import { planRoutes } from '@/modules/network';
import { decideSuggestionAction } from '@/app/targets/actions';
import { projectRoutes, scopedStrategyData } from './sections-data';
import type { scopedReadData } from './scoped-data';

type Data = Awaited<ReturnType<typeof scopedReadData>>;
export interface RestrictedPageContext { route?: string; params?: unknown; search?: unknown }
const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' ? x as Record<string, unknown> : {};
export function restrictedSection(route: string): 'orgs' | 'routes' | 'strategy' | null {
  return route.startsWith('/orgs') && !route.includes('enrichment') ? 'orgs'
    : route === '/routes' ? 'routes' : route.includes('/strategy') ? 'strategy' : null;
}
export async function RestrictedSection({ user, data, context }: { user: Principal; data: Data; context: RestrictedPageContext }) {
  const section = restrictedSection(context.route ?? '');
  if (!section) return null;
  const params = record(context.params), search = record(context.search);
  const vehicles = await listVehicles();
  const selectedVehicle = typeof params.vehicle === 'string' ? vehicles.find(v => v.slug === params.vehicle) : (await vehicleSelection()).current;
  const rows = data.rows.filter(r => !selectedVehicle || r.vehicleId === selectedVehicle.id);
  const disclosure = <p className="muted">Local database · as of {data.asOf}. {data.outsideScope} pursuits outside your access; their vehicle and owner remain visible where an LP overlaps. Licensed details are restricted.</p>;
  if (section === 'orgs') {
    const id = typeof params.id === 'string' ? params.id : null;
    const entities = [...new Map(rows.filter(r => !id || r.entityId === id).map(r => [r.entityId, r])).values()];
    return <main style={{ padding: 24 }}><h1>{id ? 'Organization or person' : 'Organizations and people'}</h1>{disclosure}
      {entities.map(e => <section className="card" key={e.entityId}><div className="chead"><h2><Link href={`/orgs/${e.entityId}`}>{e.name}</Link></h2></div><div className="cbody">
        {rows.filter(r => r.entityId === e.entityId).map(r => <p key={r.id}><Link href={`/targets/${r.id}`}>{r.vehicle}</Link> · owner {r.owner} · {r.status}{r.restricted ? ' · Approach restricted' : ''}</p>)}
        {data.overlaps.filter(r => r.entityId === e.entityId).map((r,i) => <p key={i}>Also pursued by {r.vehicle}, owner {r.owner}{r.restricted ? ' · Approach restricted' : ''}</p>)}
        {data.notes.filter(n => n.entityId === e.entityId).map(n => <p key={n.id}>{n.author ?? 'Unattributed'} · {n.at.slice(0,10)} · {data.bodies.find(b => b.id === n.id)?.body ?? 'Note body restricted'}</p>)}
      </div></section>)}
      {!entities.length && <p>No organization or person is visible here within your vehicle access.</p>}
    </main>;
  }
  if (section === 'strategy') {
    const strategies = (await scopedStrategyData(user)).filter(s => (!selectedVehicle || s.vehicleId === selectedVehicle.id)
      && (typeof params.target !== 'string' || s.entity === params.target));
    return <main style={{ padding: 24 }}><h1>Strategy</h1>{disclosure}
      <p>Strategy proposals and decisions are separate from investor consent, commitments and cash receipt.</p>
      {strategies.map(s => <section className="card" key={s.id}><div className="chead"><h2><Link href={`/targets/${s.pursuit}`}>{s.name}</Link></h2><span>{s.vehicle}</span></div><div className="cbody"><p>{s.status} · {s.author} · {s.at.slice(0,10)}</p>
        {s.body ? <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p> : <p>Strategy narrative restricted. The proposal and decision metadata remain visible.</p>}
        {s.status === 'proposed' && can(user,'mutate',{vehicle:s.vehicleId}) && <form action={decideSuggestionAction}><input type="hidden" name="suggestionId" value={s.id} /><button className="btn" name="decision" value="accept">Accept next step</button>{' '}<button className="btn" name="decision" value="dismiss">Dismiss proposal</button></form>}
      </div></section>)}
      {!strategies.length && <p>No strategy proposal on file in this view.</p>}
      <ul>{rows.map(r => <li key={r.id}><Link href={`/targets/${r.id}`}>{r.name}</Link> · {r.vehicle} · {r.status} · owner {r.owner}</li>)}</ul>
    </main>;
  }
  const targets = [...new Map(rows.map(r => [r.entityId, r])).values()];
  const target = targets.find(r => r.entityId === search.target) ?? (search.target ? null : targets[0]);
  const vehicle = target ? vehicles.find(v => v.id === target.vehicleId)! : null;
  // Search the same complete graph as the full view. Authorization only constrains the display target/scope.
  const found = target && vehicle ? await planRoutes((await currentUser()).handle, target.entityId, 3, vehicle.kind, 'team', undefined, { vehicleId: vehicle.id }) : null;
  const projected = target ? projectRoutes(user, target.vehicleId, found) : null;
  return <main style={{ padding: 24 }}><h1>Warm intro routes</h1>{disclosure}
    <form method="get"><label>Target <select name="target" defaultValue={target?.entityId ?? ''}>{targets.map(t => <option key={t.entityId} value={t.entityId}>{t.name}</option>)}</select></label>{' '}<button className="btn">Find routes</button></form>
    {projected ? <><h2>{projected.target}</h2><p>Corpus: full recorded relationship graph · {projected.coverage.edges} edges · up to {projected.coverage.maxHops} hops · dates {projected.coverage.from?.slice(0,10) ?? 'unknown'} to {projected.coverage.to?.slice(0,10) ?? 'unknown'}. Evidence text, licensed contact details and score explanations are restricted.</p>
      {projected.restrictionCount > 0 && <p role="alert">Approach restricted · {projected.restrictionCount} instructions on file.{projected.restrictionReasons.map((r,i) => <span key={i} style={{ display: 'block' }}>{r}</span>)}</p>}
      <ol>{projected.routes.map((r,i) => <li key={i}>{r.from} → {r.hops.map(h => `${h.name} (tier ${h.tier})`).join(' → ')} · {r.verdict}</li>)}</ol>
      {!projected.routes.length && <p>No supported route in the inspected records. This does not mean no route exists.</p>}
    </> : <p>No supported route search for a target within this vehicle access.</p>}
  </main>;
}
