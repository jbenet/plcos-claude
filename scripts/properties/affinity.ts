import { affinityDiscoveryProperties } from './affinity-discovery';
import type { AffinityContext } from './affinity-fixtures';

export async function affinityProperties(ctx: AffinityContext) {
  const { check, adb, aff, AFFINITY_ORIGIN, httpsTransport, KEY, scripted, slept, sleep, ok, attempt } = ctx;
  {
    let sent = 0;
    const send = aff.guardedFetch(async () => { sent++; return new Response('{}'); });
    const url = new URL('/v2/lists', AFFINITY_ORIGIN);
    const refused: string[] = [];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      if ((await attempt(() => send(url, { method }))) instanceof aff.ReadOnlyViolation) refused.push(method);
    }
    const body = await attempt(() => send(url, { method: 'GET', body: '{}' }));
    const elsewhere = await attempt(() => send(new URL('https://example.com/v2/lists'), { method: 'GET' }));
    check(
      'The Affinity client can send nothing but GET, and only to Affinity',
      refused.length === 4 && body instanceof aff.ReadOnlyViolation && elsewhere instanceof aff.ReadOnlyViolation && sent === 0,
      `${refused.join(', ')} refused; a body refused: ${body instanceof aff.ReadOnlyViolation}; another host refused: ${elsewhere instanceof aff.ReadOnlyViolation}; requests that reached fetch: ${sent}`,
    );
  }

  {
    const s1 = scripted(() => ok());
    const c = aff.affinity({ transport: s1.transport, key: KEY, sleep });
    const hook = await attempt(() => c.get('/v2/webhooks'));
    const entries = await attempt(() => c.get('/v2/transcripts/12'));
    const logged = await adb.query<{ n: string }>(`select count(*)::text as n from sources.request_log where outcome = 'refused' and endpoint = '(not allowlisted)'`);
    check(
      'Only allowlisted paths are asked for, and a refusal is logged',
      hook instanceof aff.AffinityRefused && entries instanceof aff.AffinityRefused && s1.calls.length === 0 && Number(logged[0]!.n) === 2,
      `webhooks refused: ${hook instanceof aff.AffinityRefused}; transcripts (never read) refused: ${entries instanceof aff.AffinityRefused}; sent: ${s1.calls.length}; refusals logged: ${logged[0]!.n}`,
    );
  }

  {
    const s2 = scripted(() => ok({ data: [{ id: 1 }], pagination: { nextUrl: 'https://example.com/v2/lists?cursor=2' } }));
    const c = aff.affinity({ transport: s2.transport, key: KEY, sleep });
    let pages = 0;
    const err = await attempt(async () => { for await (const _ of c.pages('/v2/lists')) pages++; });
    check(
      'A next page on another host is refused, so the key never goes there',
      pages === 1 && err instanceof aff.AffinityRefused && s2.calls.every((u) => u.origin === AFFINITY_ORIGIN),
      `pages read: ${pages}; followed elsewhere: ${!s2.calls.every((u) => u.origin === AFFINITY_ORIGIN)}`,
    );
  }

  {
    const s3 = scripted(() => ({ status: 401, body: { errors: [{ message: `bad token: Bearer ${KEY} (${KEY})` }] } }));
    const c = aff.affinity({ transport: s3.transport, key: KEY, sleep });
    const err = await attempt(() => c.get('/v2/auth/whoami'));
    const rows = await adb.query<{ t: string }>(`select concat_ws(' ', endpoint, path, note) as t from sources.request_log`);
    const leaked = [err?.message ?? '', ...rows.map((r) => r.t)].filter((t) => t.includes(KEY));
    check(
      'The key appears in no error and no log line, even when Affinity echoes it back',
      err instanceof aff.AffinityError && leaked.length === 0,
      leaked.length ? `leaked in ${leaked.length} places` : `401 surfaced as "${err?.message.slice(0, 70)}…"`,
    );
  }

  {
    slept.length = 0;
    const s4 = scripted((_u, n) => (n === 1 ? { status: 429, headers: { 'x-ratelimit-limit-user-reset': '3' }, body: {} } : ok({ tenant: {} })));
    const c = aff.affinity({ transport: s4.transport, key: KEY, sleep });
    const got = await attempt(() => c.get('/v2/auth/whoami'));
    const s5 = scripted(() => ({ status: 429, headers: { 'x-ratelimit-limit-user-reset': '1' }, body: {} }));
    const c2 = aff.affinity({ transport: s5.transport, key: KEY, sleep });
    const gaveUp = await attempt(() => c2.get('/v2/auth/whoami'));
    check(
      'A 429 waits at least the server reset and backoff, then gives up after four tries',
      got === null && slept[0] === 5000 && gaveUp instanceof aff.AffinityError && s5.calls.length === 4,
      `first: waited ${slept[0]} ms then succeeded: ${got === null}; always-429: ${s5.calls.length} tries, then ${gaveUp?.name}`,
    );
  }

  {
    const low = { ...ok().headers, 'x-ratelimit-limit-org': '100000', 'x-ratelimit-limit-org-remaining': '5000', 'x-ratelimit-limit-org-reset': '86400' };
    const s6 = scripted(() => ({ status: 200, headers: low, body: {} }));
    const c = aff.affinity({ transport: s6.transport, key: KEY, sleep });
    await attempt(() => c.get('/v2/auth/whoami'));
    const second = await attempt(() => c.get('/v2/rate-limit'));
    check(
      'Under the monthly floor the client stops before sending',
      second instanceof aff.AffinityRefused && s6.calls.length === 1,
      `5,000 of 100,000 left: second request ${second instanceof aff.AffinityRefused ? 'refused' : 'sent'}; sent in all: ${s6.calls.length}`,
    );
  }

  {
    let reached = 0;
    const https = httpsTransport(async () => { reached++; return new Response('{}'); });
    const refused = await attempt(async () => aff.affinity({ transport: https, key: KEY }));
    process.env.AFFINITY_API_KEY = KEY;
    const { affinityKey } = await import('../../lib/connectors/affinity/key');
    const seen = affinityKey();
    delete process.env.AFFINITY_API_KEY;
    const fallback = aff.affinity();
    check(
      'The demo profile cannot reach Affinity, and never sees the key',
      refused !== null && reached === 0 && seen === null && fallback.transportKind === 'fixture',
      `HTTPS transport refused: ${refused !== null}; key read in demo: ${seen !== null}; default transport: ${fallback.transportKind}`,
    );
  }

  {
    const t = await aff.testConnection(null);
    check(
      'The connection test reads the plan tier from the account’s own limits',
      !!t?.ok && /Scale or Advanced/.test(t.tier ?? '') && /Enterprise/.test(aff.readTier(null)),
      t?.ok ? `fixture account: "${t.tier}"` : `test failed: ${t?.error}`,
    );
  }
  await affinityDiscoveryProperties(ctx);
  await adb.close();
}
