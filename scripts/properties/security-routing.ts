import type { Check } from './harness';
import { NextRequest } from 'next/server';
import { proxy, config } from '../../proxy';
import { initializeRoutingSecret, trustedVehicle } from '../../lib/internal-routing';

function forwarded(response: ReturnType<typeof proxy>): Headers {
  const headers = new Headers();
  for (const key of (response.headers.get('x-middleware-override-headers') ?? '').split(',')) {
    const value = response.headers.get(`x-middleware-request-${key}`);
    if (key && value !== null) headers.set(key, value);
  }
  return headers;
}

export async function securityRoutingProperties(check: Check) {
  initializeRoutingSecret();
  const forged = { 'x-routed': '1', 'x-vehicle': 'forged-vehicle', 'x-asked-path': '/forged/path' };
  const paths = ['/api/identity/pursuit-merge', '/today', '/neurotech/strategy', '/_next/static/test.js', '/thing.svg'];
  const safe = paths.every((path) => {
    const response = proxy(new NextRequest(`http://localhost:3212${path}`, { method: 'POST', headers: forged }));
    const headers = forwarded(response);
    return headers.get('x-vehicle') !== forged['x-vehicle'] && headers.get('x-asked-path') === path
      && headers.get('x-routed') !== '1';
  });
  check('Forged routing headers are discarded on APIs, pass-through pages and file-like paths',
    safe && config.matcher.includes('/:path*'), `${paths.length} paths sanitized; matcher covers every request`);

  const response = proxy(new NextRequest('http://localhost:3212/neurotech/pipeline/fixture?view=list', { headers: forged }));
  const headers = forwarded(response);
  const target = response.headers.get('x-middleware-rewrite')!;
  const again = proxy(new NextRequest(target, { headers }));
  check('A signed internal rewrite preserves its path vehicle and reenters without a redirect loop',
    target.endsWith('/targets/fixture?view=list') && trustedVehicle(headers) === 'neurotech'
      && again.status === 200 && !again.headers.has('location') && !again.headers.has('x-middleware-rewrite'),
    'Invented vehicle URL rewrites once and passes through on genuine reentry');

  const changed = new Headers(headers); changed.set('x-vehicle', 'rails');
  const changedAsked = new Headers(headers); changedAsked.set('x-asked-path', '/rails/pipeline');
  const wrongPath = proxy(new NextRequest('http://localhost:3212/dev/status', { headers }));
  const wrongMethod = proxy(new NextRequest(target, { headers, method: 'POST' }));
  check('Session ignores unsigned or tampered vehicles and proxy refuses a marker on another path or method',
    trustedVehicle(new Headers(forged)) === null && trustedVehicle(changed) === null
      && trustedVehicle(changedAsked) === null && wrongPath.status === 307
      && trustedVehicle(forwarded(wrongMethod)) === null,
    'Unsigned/tampered contexts rejected; signed route bound to target query and method');
}
