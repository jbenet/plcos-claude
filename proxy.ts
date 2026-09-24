import { NextResponse, type NextRequest } from 'next/server';

/**
 * Routes that follow the sidebar (N65, issue 0009). Juan: "the route should follow the hierarchy
 * in the sidebar: /developer/issues not just /issues, /plc-neurotech/overview not just /overview…
 * so people can properly deep-link to the right pages."
 *
 *   /<vehicle>/<module>/…   a vehicle's module, the vehicle in the path. Rewritten to the page
 *                           that has always served it, with the vehicle passed in a header, which
 *                           the page reads before the cookie (lib/session.ts). The cookie is set
 *                           to match, so the next unprefixed link agrees with the address.
 *   /developer/<page>/…     the Developer section: its pages, which still live at /dev, /issues
 *                           and /agents.
 *   the old addresses       redirected to their place in the hierarchy (a GET only; a form or a
 *                           server action posts where it always did), so the address bar says
 *                           where you are and a copied link means the same thing to anyone.
 *
 * The four modules already scoped by path (visualizations, strategy, calendar, fit) live under
 * app/[vehicle] and pass through untouched.
 */

const PREFIX = process.env.DATA_PROFILE === 'real' ? 'capitalos_real_' : 'capitalos_';
const USER_COOKIE = `${PREFIX}user`;
const VEHICLE_COOKIE = `${PREFIX}vehicle`;

/** A vehicle's modules served from top-level pages; the address's name when it differs. */
const MODULES: Record<string, string> = {
  overview: 'overview', pipeline: 'targets', routes: 'routes', selection: 'selection', asks: 'asks', meetings: 'meetings',
  decisions: 'decisions', 'soft-hard': 'soft-hard', status: 'vehicles', materials: 'materials', close: 'close', spv: 'spv',
  grants: 'grants', compliance: 'compliance',
};
const PAGE_TO_PATH = Object.fromEntries(Object.entries(MODULES).map(([path, page]) => [page, path]));
/** First segments that are pages of their own, never a vehicle. */
const RESERVED = new Set([
  '_next', 'api', 'developer', 'dev', 'issues', 'agents', 'm', 'today', 'approvals', 'standup', 'everything', 'orgs', 'rnd',
  'research', 'forecast', 'content', 'performance', 'library', 'relationships', 'operations', 'plays', 'settings', 'system',
  'calendar', 'visualizations', 'fit', 'favicon.ico', ...Object.values(MODULES), ...Object.keys(MODULES),
]);
const DEV_PAGES: Record<string, string> = { issues: '/issues', agents: '/agents' };

function currentVehicle(req: NextRequest): string {
  const handle = req.cookies.get(USER_COOKIE)?.value ?? '';
  const raw = req.cookies.get(VEHICLE_COOKIE)?.value;
  if (!raw) return 'all';
  if (!raw.startsWith('{')) return raw || 'all';
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[handle] ?? Object.values(map)[0] ?? 'all';
  } catch { return 'all'; }
}

function rememberVehicle(req: NextRequest, res: NextResponse, slug: string): NextResponse {
  const handle = req.cookies.get(USER_COOKIE)?.value;
  const raw = req.cookies.get(VEHICLE_COOKIE)?.value;
  let map: Record<string, string> = {};
  try { map = raw?.startsWith('{') ? (JSON.parse(raw) as Record<string, string>) : {}; } catch { map = {}; }
  const key = handle ?? Object.keys(map)[0] ?? 'juan';
  if (map[key] !== slug) {
    map[key] = slug;
    res.cookies.set(VEHICLE_COOKIE, JSON.stringify(map), { httpOnly: true, sameSite: 'lax', path: '/' });
  }
  return res;
}

/** The same request's URL with a new path: a clone of nextUrl keeps its origin, so a rewrite stays internal. */
function at(req: NextRequest, path: string): URL {
  const url = req.nextUrl.clone();
  const [p, q] = path.split('?');
  url.pathname = p!;
  url.search = q ? `?${q}` : req.nextUrl.search;
  return url;
}

/**
 * A rewrite marks its request, so the proxy passes it through if it sees it again. On the real
 * server a rewritten request came back through here (seen while it was bound to 127.0.0.1), and
 * without the mark the old-address redirect sent /developer/… round in a loop.
 */
const ROUTED = 'x-routed';
/** The address the browser asked for, before the rewrite: what the rail marks as the page you're on (issue 0011, real). */
export const ASKED_PATH = 'x-asked-path';
function rewrite(req: NextRequest, path: string, extra: Record<string, string> = {}): NextResponse {
  const headers = new Headers(req.headers);
  headers.set(ROUTED, '1');
  headers.set(ASKED_PATH, req.nextUrl.pathname);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return NextResponse.rewrite(at(req, path), { request: { headers } });
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (req.headers.get(ROUTED)) return NextResponse.next();
  const seg = pathname.split('/').filter(Boolean);
  const rest = (from: number) => (seg.length > from ? `/${seg.slice(from).join('/')}` : '');

  // The Developer section, where its sidebar puts it.
  if (seg[0] === 'developer') {
    const page = seg[1] ?? '';
    const target = DEV_PAGES[page] ? `${DEV_PAGES[page]}${rest(2)}` : page ? `/dev${rest(1)}` : '/dev/status';
    return rewrite(req, target);
  }
  if ((seg[0] === 'dev' || seg[0] === 'issues' || seg[0] === 'agents') && req.method === 'GET') {
    const to = seg[0] === 'dev' ? `/developer${rest(1)}` : `/developer${rest(0)}`;
    return NextResponse.redirect(at(req, to), 307);
  }

  // A vehicle's module, with the vehicle in the path.
  if (seg.length >= 2 && !RESERVED.has(seg[0]!) && MODULES[seg[1]!]) {
    return rememberVehicle(req, rewrite(req, `/${MODULES[seg[1]!]}${rest(2)}`, { 'x-vehicle': seg[0]! }), seg[0]!);
  }
  // The old address of one: to its place under the vehicle in view.
  if (seg.length >= 1 && PAGE_TO_PATH[seg[0]!] && req.method === 'GET') {
    return NextResponse.redirect(at(req, `/${currentVehicle(req)}/${PAGE_TO_PATH[seg[0]!]}${rest(1)}`), 307);
  }
  return NextResponse.next();
}

export const config = {
  // Everything but Next's own files and the API.
  matcher: ['/((?!_next/|api/|favicon\\.ico|.*\\.(?:png|webp|jpg|svg|woff2?|ico|css|js)$).*)'],
};
