import { currentUser } from '@/lib/auth';
import * as raw from '@/modules/network';
import { licensedAccess } from './r3';
export * from '@/modules/network';
function edgeForDisplay(edge: raw.Edge): raw.Edge {
  return { ...edge, evidence: edge.evidence.map(e => e.source === 'dakota'
    ? { source: 'dakota', as_of: e.as_of, note: 'Licensed evidence restricted.' } : e) };
}
export function redactLicensedRoutes(search: raw.RouteSearch): raw.RouteSearch {
  const route = (r: raw.Route): raw.Route => ({ ...r,
    viaContact: r.viaContact ? { ...r.viaContact, role: 'contact details restricted' } : undefined,
    hops: r.hops.map(h => ({ ...h, edge: edgeForDisplay(h.edge) })),
  });
  return { ...search, structural: undefined, routes: search.routes.map(route), topRoutes: search.topRoutes?.map(route) };
}
export async function planRoutes(...args: Parameters<typeof raw.planRoutes>) {
  const [user, data] = await Promise.all([currentUser(), raw.planRoutes(...args)]);
  return !data || licensedAccess(user) ? data : redactLicensedRoutes(data);
}
export async function listEdgesForEntities(...args: Parameters<typeof raw.listEdgesForEntities>) {
  const [user, data] = await Promise.all([currentUser(), raw.listEdgesForEntities(...args)]);
  return licensedAccess(user) ? data : data.map(edgeForDisplay);
}
