import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Runtime-only; next.config initializes this before Next forks its request workers.
 * Never put this in Next's `env` config (which embeds values in bundles).
 */
export function initializeRoutingSecret(): void {
  process.env.PLCOS_INTERNAL_ROUTING_KEY ??= randomBytes(32).toString('hex');
}
const INTERNAL = ['x-routed', 'x-vehicle', 'x-asked-path'] as const;
// GUESS: enough for one internal rewrite, with a short replay window on a leaked marker.
const ROUTING_CONTEXT_TTL_MS = 60_000;
type Routing = { path: string; method: string; asked: string; vehicle: string | null; expires: number };

export function stripRoutingHeaders(input: Headers): Headers {
  const clean = new Headers(input);
  for (const name of INTERNAL) clean.delete(name);
  return clean;
}

function signature(payload: string): Buffer | null {
  const key = process.env.PLCOS_INTERNAL_ROUTING_KEY;
  return key ? createHmac('sha256', key).update(payload).digest() : null;
}

export function routingContext(input: Pick<Headers, 'get'>): Routing | null {
  const token = input.get('x-routed') ?? '';
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1]!)) return null;
  const expected = signature(parts[0]!);
  if (!expected || !timingSafeEqual(expected, Buffer.from(parts[1]!, 'hex'))) return null;
  try {
    const context = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as Routing;
    if (typeof context.path !== 'string' || typeof context.method !== 'string'
      || typeof context.expires !== 'number' || context.expires < Date.now()
      || context.asked !== input.get('x-asked-path') || context.vehicle !== input.get('x-vehicle')) return null;
    return context;
  } catch { return null; }
}

export function internalRoutingHeaders(input: Headers, path: string, method: string, asked: string, vehicle: string | null): Headers {
  const clean = stripRoutingHeaders(input);
  const context: Routing = { path, method, asked, vehicle, expires: Date.now() + ROUTING_CONTEXT_TTL_MS };
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
  const signed = signature(payload);
  if (!signed) throw new Error('Internal routing key was not initialized by the server.');
  clean.set('x-routed', `${payload}.${signed.toString('hex')}`);
  clean.set('x-asked-path', asked);
  if (vehicle) clean.set('x-vehicle', vehicle);
  return clean;
}

/** Session never treats a raw request header as the vehicle selected by the proxy. */
export function trustedVehicle(input: Pick<Headers, 'get'>): string | null {
  return routingContext(input)?.vehicle ?? null;
}
