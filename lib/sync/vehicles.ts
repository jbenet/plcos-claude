import { createVehicle, VehicleRefused, type NewVehicle } from '@/modules/platform';
import type { Queryable } from '@/lib/db';
import { auditSync, type SyncCaller } from './auth';
import { pushRefusal, type PushAnswer } from './push';

/**
 * POST /api/sync/vehicles: an Admin adds a vehicle by token (Juan, 6 Oct 2026: "you make sure you can do #1
 * after token ... maybe need to dev it in"), so Claude can add one without a person clicking through
 * Settings → Vehicles. The same writer as that form (createVehicle in modules/platform/vehicles.ts) and so
 * the same rules: Admin only, every field checked, the exemption never defaulted, a taken slug or name
 * refused and never updated, one `vehicle.created` audit row. A sync:admin token, which only an Admin
 * holds; nothing here edits or removes a vehicle. Every call is one `mcp.call` audit row too.
 *
 *   { "name", "slug", "kind", "exemption", "phase"?, "target"?, "opens"?, "closes"?, "aliases"? } → 201 { slug, name }
 */

const MAX_BYTES = 4 * 1024;
const FIELDS = ['name', 'slug', 'kind', 'exemption', 'phase', 'target', 'opens', 'closes', 'aliases'] as const;

export interface VehiclesOptions { db?: Queryable }

export async function addVehicle(caller: SyncCaller, request: Request, o: VehiclesOptions = {}): Promise<PushAnswer> {
  const started = Date.now();
  const answer = async (status: number, outcome: 'ok' | 'refused' | 'invalid' | 'error', body: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
    await auditSync(caller, 'vehicles', outcome, { ms: Date.now() - started, ...detail });
    return { status, body: { ok: status < 300, ...body } };
  };
  const refusal = pushRefusal();
  if (refusal) return answer(403, 'refused', { error: refusal }, { reason: 'profile' });
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return answer(413, 'invalid', { error: `A vehicle is at most ${MAX_BYTES} bytes.` }, { reason: 'size' });
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return answer(400, 'invalid', { error: 'The call is not JSON.' }, { reason: 'json' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return answer(422, 'invalid', { error: 'Send one vehicle as a JSON object.' }, { reason: 'shape' });
  const extra = Object.keys(input).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) return answer(422, 'invalid', { error: `Unknown fields: ${extra.slice(0, 5).join(', ')}. A vehicle takes ${FIELDS.join(', ')}.` }, { reason: 'fields' });
  const v = input as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
  const vehicle: NewVehicle = {
    name: str(v.name) ?? '', slug: str(v.slug) ?? '', kind: str(v.kind) ?? '', exemption: str(v.exemption) ?? '', phase: str(v.phase),
    target: typeof v.target === 'number' || typeof v.target === 'string' ? v.target : null,
    opens: str(v.opens) ?? null, closes: str(v.closes) ?? null,
    aliases: Array.isArray(v.aliases) ? v.aliases.filter((a): a is string => typeof a === 'string') : str(v.aliases) ?? null,
  };
  try {
    const row = await createVehicle(caller.user, vehicle, o.db);
    return answer(201, 'ok', { slug: row.slug, name: row.name }, { slug: row.slug });
  } catch (e) {
    if (e instanceof VehicleRefused) return answer(409, 'refused', { error: e.message }, { reason: 'refused' });
    return answer(500, 'error', { error: 'The vehicle was not added.' }, { reason: 'error' });
  }
}
