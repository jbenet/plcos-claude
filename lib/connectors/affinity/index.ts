import { config } from '@/config/deployment';
import {
  latestConnectionTest, logRequest, recordConnectionTest, requestsThisMonth,
  type ConnectionTest, type RateWindow,
} from '@/modules/sources';
import { affinityClient, httpsTransport, type AffinityClient, type ClientOptions } from './client';
import { fixtureTransport } from './fixture';
import { affinityKey } from './key';

export { ALLOWED, allowed, type Endpoint } from './allowlist';
export { AffinityError, AffinityRefused, type AffinityClient, type Budget, type Transport } from './client';
export { ReadOnlyViolation, guardedFetch } from './fetch';

export class AffinityKeyMissing extends Error {
  constructor() {
    super(
      'No Affinity key in this server. npm run dev:real reads it from one macOS Keychain item, which ' +
        'npm run key:store creates — it asks for the key without showing it. Then restart the real server ' +
        'and allow the Keychain to hand it over.',
    );
    this.name = 'AffinityKeyMissing';
  }
}

/**
 * The client for this profile. Real talks to Affinity over HTTPS with the key from the
 * macOS Keychain; demo talks to the fake in fixtures/affinity/. Neither may use the other's
 * transport: the demo must never reach Affinity, and the real database must never receive
 * the fake's invented records.
 */
export function affinity(overrides: Partial<Pick<ClientOptions, 'transport' | 'key' | 'sleep' | 'now'>> = {}): AffinityClient {
  const real = config.data.profile === 'real';
  const transport = overrides.transport ?? (real ? httpsTransport() : fixtureTransport());
  if (real && transport.kind !== 'https') throw new Error('The real profile talks to Affinity itself, never to a fake.');
  if (!real && transport.kind === 'https') throw new Error('The demo profile never talks to Affinity.');
  const key = overrides.key ?? (real ? affinityKey() : 'demo-fixture-key');
  if (!key) throw new AffinityKeyMissing();
  return affinityClient({
    transport,
    key,
    limits: {
      maxPerMinute: config.affinity.maxPerMinute,
      monthlyShare: config.affinity.monthlyShare,
      monthlyFloor: config.affinity.monthlyFloor,
    },
    log: logRequest,
    usedThisMonth: () => requestsThisMonth('affinity'),
    sleep: overrides.sleep,
    now: overrides.now,
  });
}

/** Whether this server could talk to Affinity at all, and if not, why not. */
export function affinityReady(): { ready: boolean; why: string } {
  if (config.data.profile !== 'real') {
    return { ready: true, why: 'Demo: a fake Affinity served from fixtures/affinity/. Nothing here contacts Affinity.' };
  }
  return affinityKey()
    ? { ready: true, why: 'Key present, from the macOS Keychain. It is held by this server process only.' }
    : { ready: false, why: new AffinityKeyMissing().message };
}

interface WhoAmI {
  tenant: { id: number; name: string; subdomain: string };
  user: { id: number; firstName: string; lastName: string | null; emailAddress: string };
  grant: { type: string; scopes: string[]; createdAt: string };
}
interface RateLimit {
  callerPerMinute: RateWindow;
  orgPerMonth?: RateWindow;
}

/**
 * Open question 1, answered by the account instead of by memory. Affinity's limits are the
 * same for Scale and Advanced, so the most the API can say about those two is "one of them".
 */
export function readTier(perMonth: RateWindow | null): string {
  if (perMonth === null) return 'No monthly cap: Enterprise, the only plan without one.';
  if (perMonth.limit === 100_000) {
    return '100,000 requests a month: Scale or Advanced. The API cannot tell them apart — Advanced is the one with Data Share.';
  }
  return `${perMonth.limit.toLocaleString('en-US')} requests a month: not a published tier. Ask Affinity.`;
}

/** Two requests: whose key, which account, and the budget. Recorded either way. */
export async function testConnection(testedBy: string | null): Promise<ConnectionTest | null> {
  const failed = async (error: string) => {
    await recordConnectionTest({
      source: 'affinity', ok: false, testedBy, tenant: null, keyUser: null, grant: null,
      perMinute: null, perMonth: null, tier: null, error,
    });
    return latestConnectionTest('affinity');
  };

  let client: AffinityClient;
  try {
    client = affinity();
  } catch (err) {
    return failed(err instanceof Error ? err.message : 'Could not build the client.');
  }
  try {
    const who = await client.get<WhoAmI>('/v2/auth/whoami');
    let limits: RateLimit | null = null;
    try {
      limits = await client.get<RateLimit>('/v2/rate-limit');
    } catch {
      // A BETA endpoint. The headers on whoami carry the same numbers, so its failure costs
      // nothing but a row in the log.
    }
    const seen = client.budget();
    const perMinute = limits?.callerPerMinute ?? seen.perMinute;
    const perMonth = limits ? (limits.orgPerMonth ?? null) : seen.perMonth === 'none' ? null : seen.perMonth;
    await recordConnectionTest({
      source: 'affinity', ok: true, testedBy,
      tenant: who.tenant, keyUser: who.user, grant: who.grant,
      perMinute: perMinute ?? null, perMonth,
      tier: perMonth === undefined ? null : readTier(perMonth),
      error: null,
    });
    return latestConnectionTest('affinity');
  } catch (err) {
    return failed(err instanceof Error ? err.message : 'Unknown error.');
  }
}

/** What a grant's scopes mean for this tool, in words. */
export function readScopes(scopes: string[]): string {
  const writes = scopes.some((s) => s === 'api' || s === 'mcp');
  if (writes) return 'This key can write. Read-only is enforced by this client, not by Affinity.';
  if (scopes.length && scopes.every((s) => s.endsWith('.read') || s === 'offline_access')) {
    return 'Read-only on Affinity’s side too: Affinity itself refuses a write with this grant.';
  }
  return 'Scopes this tool does not recognise. Treated as able to write.';
}
