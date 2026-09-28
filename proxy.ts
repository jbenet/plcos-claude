import { NextResponse, type NextRequest } from 'next/server';
import { internalRoutingHeaders, routingContext, stripRoutingHeaders } from '@/lib/internal-routing';
import { config as deployment } from '@/config/deployment';
import { canonicalPath, DEV_PAGES, MODULE_PAGES, RESERVED, vehicleOfPath } from '@/lib/paths';

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
 * app/[vehicle] and pass through untouched. The table of where each page lives is lib/paths.ts,
 * which the links read too, so a click goes straight to the address this would redirect it to.
 */

// The same names as lib/auth/local.ts and lib/session.ts, which carry the port.
const USER_COOKIE = `${deployment.data.cookiePrefix}user`;
const VEHICLE_COOKIE = `${deployment.data.cookiePrefix}vehicle`;

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

/** The original address is carried only in authenticated internal request headers. */
export const ASKED_PATH = 'x-asked-path';
function rewrite(req: NextRequest, path: string, vehicle: string | null = null): NextResponse {
  const target = at(req, path);
  const headers = internalRoutingHeaders(req.headers, target.pathname + target.search, req.method, req.nextUrl.pathname, vehicle);
  return NextResponse.rewrite(target, { request: { headers } });
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // A rewrite can reenter the proxy. Only our signed, request-bound context can bypass
  // canonical redirects; arbitrary client markers and modified contexts are discarded.
  const routed = routingContext(req.headers);
  if (routed && routed.path === pathname + req.nextUrl.search && routed.method === req.method) {
    return NextResponse.next({ request: { headers: new Headers(req.headers) } });
  }
  const clean = stripRoutingHeaders(req.headers);
  const seg = pathname.split('/').filter(Boolean);
  const rest = (from: number) => (seg.length > from ? `/${seg.slice(from).join('/')}` : '');

  // The Developer section, where its sidebar puts it.
  if (seg[0] === 'developer') {
    const page = seg[1] ?? '';
    const target = Object.hasOwn(DEV_PAGES, page) ? `${DEV_PAGES[page]}${rest(2)}` : page ? `/dev${rest(1)}` : '/dev/status';
    return rewrite(req, target);
  }

  // A vehicle's module, with the vehicle in the path.
  if (seg.length >= 2 && (!RESERVED.has(seg[0]!) || seg[0] === 'grants') && Object.hasOwn(MODULE_PAGES, seg[1]!)) {
    return rememberVehicle(req, rewrite(req, `/${MODULE_PAGES[seg[1]!]}${rest(2)}`, seg[0]!), seg[0]!);
  }
  // An old address: to its place in the hierarchy, under the vehicle in view.
  if (req.method === 'GET') {
    const to = canonicalPath(pathname, currentVehicle(req));
    if (to !== pathname) return NextResponse.redirect(at(req, to), 307);
  }
  const vehicle = vehicleOfPath(pathname);
  const headers = internalRoutingHeaders(clean, pathname + req.nextUrl.search, req.method, pathname, vehicle);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // APIs and paths containing file extensions can execute handlers/actions too.
  // Sanitize every incoming request, not just canonical page URLs.
  matcher: ['/:path*'],
};
