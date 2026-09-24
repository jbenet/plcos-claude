/**
 * Where every page lives in the address (N65, issue 0009), in one table that the proxy and the
 * links share. The proxy rewrites /<vehicle>/<module> to the page that serves it, and redirects an
 * old address (/targets/…) to its place; the links (components/ui/AppLink) put an old address in
 * its place before anyone clicks it, because a client navigation that meets the redirect follows
 * it mid-flight — Chrome shrugs, and Safari fetched twice and threw (issues 0027–0028, real).
 *
 * Client-safe: no server imports.
 */

/** A vehicle's modules served from top-level pages: the address's name → the page's. */
export const MODULE_PAGES: Record<string, string> = {
  overview: 'overview', pipeline: 'targets', routes: 'routes', selection: 'selection', asks: 'asks', meetings: 'meetings',
  decisions: 'decisions', 'soft-hard': 'soft-hard', status: 'vehicles', materials: 'materials', close: 'close', spv: 'spv',
  grants: 'grants', compliance: 'compliance',
};
/** The page's name → the address's. */
export const PAGE_MODULES: Record<string, string> = Object.fromEntries(Object.entries(MODULE_PAGES).map(([path, page]) => [page, path]));
/** The four modules scoped by path since N1, served from app/[vehicle]. */
const VEHICLE_ROUTES = new Set(['visualizations', 'strategy', 'calendar', 'fit']);
/** First segments that are pages of their own, never a vehicle. */
export const RESERVED = new Set([
  '_next', 'api', 'developer', 'dev', 'issues', 'agents', 'm', 'today', 'approvals', 'standup', 'everything', 'orgs', 'rnd',
  'research', 'forecast', 'content', 'performance', 'library', 'relationships', 'operations', 'plays', 'settings', 'system',
  'calendar', 'visualizations', 'fit', 'favicon.ico', ...Object.values(MODULE_PAGES), ...Object.keys(MODULE_PAGES),
]);
/** The Developer section's pages that live outside /dev. */
export const DEV_PAGES: Record<string, string> = { issues: '/issues', agents: '/agents' };

/** The vehicle an address is about, when it names one: /neurotech/pipeline → neurotech. */
export function vehicleOfPath(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length < 2 || RESERVED.has(seg[0]!)) return null;
  return Object.hasOwn(MODULE_PAGES, seg[1]!) || VEHICLE_ROUTES.has(seg[1]!) ? seg[0]! : null;
}

/**
 * An old address in its place: /targets/abc?x → /<vehicle>/pipeline/abc?x, /dev/status →
 * /developer/status, /issues/0001 → /developer/issues/0001. Any other address comes back as it was.
 */
export function canonicalPath(href: string, vehicle: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const tail = cut < 0 ? '' : href.slice(cut);
  const seg = path.split('/').filter(Boolean);
  const rest = (from: number) => (seg.length > from ? `/${seg.slice(from).join('/')}` : '');
  if (seg[0] === 'dev') return `/developer${rest(1)}${tail}`;
  if (seg[0] === 'issues' || seg[0] === 'agents') return `/developer${rest(0)}${tail}`;
  const mod = seg[0] && Object.hasOwn(PAGE_MODULES, seg[0]) ? PAGE_MODULES[seg[0]] : undefined;
  return mod ? `/${vehicle}/${mod}${rest(1)}${tail}` : href;
}
