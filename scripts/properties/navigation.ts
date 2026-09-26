import type { Check } from './harness';

export async function proxyProperties(check: Check) {
  // Routes that follow the sidebar (N65, issue 0009): the proxy rewrites /<vehicle>/<module> and
  // /developer/<page> to the pages that serve them, and sends the old addresses to their place.
  {
    const { NextRequest } = await import('next/server');
    const { proxy } = await import('../../proxy');
    const call = (path: string, init: { method?: string; cookie?: string; routed?: boolean } = {}) => {
      const headers = new Headers();
      if (init.cookie) headers.set('cookie', init.cookie);
      if (init.routed) headers.set('x-routed', '1');
      const r = proxy(new NextRequest(`http://127.0.0.1:3100${path}`, { method: init.method ?? 'GET', headers }));
      return { status: r.status, location: r.headers.get('location'), rewrite: r.headers.get('x-middleware-rewrite'), vehicle: r.headers.get('x-middleware-request-x-vehicle'), asked: r.headers.get('x-middleware-request-x-asked-path') };
    };
    const dev = call('/developer/enrich');
    const oldDev = call('/dev/enrich?imported=3');
    const post = call('/dev/enrich', { method: 'POST' });
    const lp = call('/neurotech/pipeline/abc');
    const { config: { data: { cookiePrefix: jar } } } = await import('../../config/deployment');
    const old = call('/targets/abc', { cookie: `${jar}user=juan; ${jar}vehicle=` + encodeURIComponent(JSON.stringify({ juan: 'rails' })) });
    const scoped = call('/neurotech/strategy');
    const again = call('/dev/enrich', { routed: true });
    const ok =
      dev.rewrite?.endsWith('/dev/enrich') === true && oldDev.status === 307 && oldDev.location?.endsWith('/developer/enrich?imported=3') === true &&
      post.status !== 307 && lp.rewrite?.endsWith('/targets/abc') === true && lp.vehicle === 'neurotech' && lp.asked === '/neurotech/pipeline/abc' &&
      old.status === 307 && old.location?.endsWith('/rails/pipeline/abc') === true && !scoped.rewrite && scoped.status !== 307 && again.status !== 307 && !again.rewrite;
    check(
      'The address follows the sidebar: /<vehicle>/<module> and /developer/<page> reach their pages and carry the address asked for (issue 0011, real), old addresses redirect to their place, a POST is never redirected, and a rewritten request passes through',
      ok,
      `/developer/enrich → ${dev.rewrite?.replace(/^https?:\/\/[^/]+/, '')}; /dev/enrich → ${oldDev.status} ${oldDev.location?.replace(/^https?:\/\/[^/]+/, '')}; POST /dev/enrich → ${post.status}; ` +
        `/neurotech/pipeline/abc → ${lp.rewrite?.replace(/^https?:\/\/[^/]+/, '')} (vehicle ${lp.vehicle}, asked ${lp.asked}); /targets/abc with Rails in view → ${old.status} ${old.location?.replace(/^https?:\/\/[^/]+/, '')}; ` +
        `/neurotech/strategy passes through: ${!scoped.rewrite}; a rewritten request seen again passes through: ${again.status !== 307 && !again.rewrite}`,
    );
  }
}

export async function pathProperties(check: Check) {
  {
    // Issues 0027–0028 (real): a link goes straight to where the proxy would send it, and the
    // address it lands on is never redirected again.
    const { canonicalPath, vehicleOfPath, PAGE_MODULES } = await import('../../lib/paths');
    const cases: Array<[string, string, string]> = [
      ['/targets/abc?x=1#h', 'neurotech', '/neurotech/pipeline/abc?x=1#h'],
      ['/routes?target=t1', 'all', '/all/routes?target=t1'],
      ['/vehicles', 'rails', '/rails/status'],
      ['/dev/status', 'all', '/developer/status'],
      ['/issues/0001', 'all', '/developer/issues/0001'],
      ['/all/routes?target=t1', 'neurotech', '/all/routes?target=t1'],
      ['/today', 'all', '/today'],
      ['/constructor', 'all', '/constructor'],
      ['https://example.com/targets', 'all', 'https://example.com/targets'],
    ];
    const wrong = cases.filter(([href, v, want]) => canonicalPath(href, v) !== want);
    const pages = Object.keys(PAGE_MODULES).flatMap((page) => [`/${page}`, `/${page}/x?y=1`]);
    const unstable = pages.filter((h) => { const once = canonicalPath(h, 'all'); return canonicalPath(once, 'all') !== once || once === h; });
    const vehicles: Array<[string, string | null]> = [
      ['/neurotech/pipeline/abc', 'neurotech'], ['/all/calendar', 'all'], ['/today', null],
      ['/everything/visualizations', null], ['/developer/issues', null], ['/x/constructor', null],
    ];
    const misread = vehicles.filter(([p, v]) => vehicleOfPath(p) !== v);
    check('An old address is put in its place before a click, and the place is never redirected again',
      wrong.length === 0 && unstable.length === 0 && misread.length === 0,
      `${cases.length - wrong.length} of ${cases.length} addresses placed right; ${pages.length - unstable.length} of ${pages.length} old addresses land on a settled one; `
        + `${vehicles.length - misread.length} of ${vehicles.length} vehicles read from the address${wrong.length ? `; wrong: ${wrong.map((w) => w[0]).join(', ')}` : ''}${misread.length ? `; misread: ${misread.map((m) => m[0]).join(', ')}` : ''}`);
  }
}
