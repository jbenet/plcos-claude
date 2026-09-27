import { renderKey, singleFlight, type RenderContext } from '../../lib/in-flight';
import type { Check } from './harness';

export async function renderProperties(check: Check) {
  const share = singleFlight();
  let release!: () => void, starts = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const render = async () => { starts++; await gate; return { rendered: true }; };
  const context: RenderContext = { cookies: 'user=invented-one', vehicle: 'invented-fund', host: 'localhost:3210', askedPath: '/invented-fund/routes' };
  const inputs = { params: { vehicle: 'invented-fund', section: 'routes' }, search: { target: 'invented-a', page: '1' } };
  const key = renderKey('/routes', inputs, context);
  const reordered = renderKey('/routes', {
    search: { page: '1', target: 'invented-a' }, params: { section: 'routes', vehicle: 'invented-fund' },
  }, context);
  const otherKeys = [
    renderKey('/routes', { ...inputs, search: { ...inputs.search, target: 'invented-b' } }, context),
    renderKey('/routes', { ...inputs, params: { ...inputs.params, vehicle: 'other-fund' } }, context),
    renderKey('/routes', inputs, { ...context, cookies: 'user=invented-two' }),
    renderKey('/routes', inputs, { ...context, vehicle: 'other-fund' }),
    renderKey('/routes', inputs, { ...context, host: '127.0.0.1:3210' }),
    renderKey('/routes', inputs, { ...context, askedPath: '/other-fund/routes' }),
    renderKey('/other-page', inputs, context),
  ];
  const first = share(key, render);
  const retry = share(reordered, render);
  const others = otherKeys.map(other => share(other, render));
  await Promise.resolve();
  check('Actual render keys coalesce reordered params and isolate route, search, cookie, vehicle, host and asked path',
    first === retry && new Set([first, ...others]).size === 8 && starts === 8,
    'The production key builder joins one reordered retry and isolates each independently changed request input.');
  check('Render keys preserve repeated search parameter order',
    renderKey('/routes', { search: { tags: ['a', 'b'] } }, context) !== renderKey('/routes', { search: { tags: ['b', 'a'] } }, context),
    'Only object property order is normalized; ordered arrays remain distinct.');
  release();
  await Promise.all([first,retry,...others]);
  await share(key, render);
  let failures = 0;
  for (let i=0;i<2;i++) await share('failing', async () => { failures++; throw new Error('fixture failure'); }).catch(() => {});
  check('Completed and failed renders leave no stale page promise', starts === 9 && failures === 2,
    'A later request reloads after success; a rejected render can be retried.');
}
