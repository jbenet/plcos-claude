import { getDb } from '@/lib/db';
import { openTicket, requireApprovedTicket } from '@/modules/governance';
import { getAsset, listWrapRules } from './repo';
import { USE_RANK, type Audience, type WrapCheck } from './types';

/**
 * The wrong-wrap check. Vehicle (by exemption) × instrument → what may be said.
 *
 * Every reason is returned, not just the first, because a send that fails two rules needs
 * both fixed and reporting one at a time turns that into two round trips.
 */
export async function checkWrap(args: {
  exemption: string;
  instrument: string;
  audience: Audience | null;
  permittedUse: 'public' | 'accredited_only' | 'internal';
}): Promise<WrapCheck> {
  const rules = await listWrapRules();
  const rule = rules.find((r) => r.exemption === args.exemption && r.instrument === args.instrument) ?? null;
  const refusals: string[] = [];

  if (!rule) {
    refusals.push(
      `No wrap rule covers ${args.exemption} × ${args.instrument}. The matrix is a closed set, ` +
      'so an uncovered combination is refused rather than assumed to be fine.',
    );
    return { allowed: false, rule: null, refusals };
  }
  if (!args.audience) {
    refusals.push('A canonical asset has no audience and is not sendable. Send a variant.');
  } else if (!rule.allowedAudiences.includes(args.audience)) {
    refusals.push(
      `${args.audience} is not an allowed audience for ${args.exemption} × ${args.instrument}. ` +
      rule.note,
    );
  }
  if (USE_RANK[args.permittedUse] > USE_RANK[rule.maxPermittedUse]) {
    refusals.push(
      `This material is marked "${args.permittedUse}" and the wrap allows at most ` +
      `"${rule.maxPermittedUse}". ${rule.note}`,
    );
  }

  return { allowed: refusals.length === 0, rule, refusals };
}

/**
 * Ask to send. The wrap check runs first: a refusal is recorded and no ticket is opened,
 * because an approval queue full of things that may not legally be sent trains people to
 * approve without reading.
 */
export async function requestSend(
  actorId: string,
  args: { assetId: string; entityId: string; vehicleId: string; instrument: string },
): Promise<{ sendId: string; ticketId: string | null; check: WrapCheck }> {
  const db = await getDb();
  const asset = await getAsset(args.assetId);
  if (!asset) throw new Error(`No asset ${args.assetId}`);

  const vehicle = await db.one<{ name: string; exemption: string }>(
    'select name, exemption from platform.vehicle where id = $1',
    [args.vehicleId],
  );
  const entity = await db.one<{ display_name: string }>(
    'select display_name from identity.entity where entity_id = $1',
    [args.entityId],
  );
  if (!vehicle || !entity) throw new Error('Unknown vehicle or entity.');

  const check = await checkWrap({
    exemption: vehicle.exemption,
    instrument: args.instrument,
    audience: asset.audience,
    permittedUse: asset.permittedUse,
  });

  if (asset.status !== 'approved') {
    check.refusals.push(`The asset is "${asset.status}", not approved. Only approved material is sendable.`);
    check.allowed = false;
  }
  if (asset.flags.length > 0) {
    check.refusals.push(
      `${asset.flags.length} open refresh flag${asset.flags.length === 1 ? '' : 's'}: a claim ` +
      'underneath this asset changed and the asset has not been re-checked.',
    );
    check.allowed = false;
  }

  return db.transaction(async (tx) => {
    const rows = await tx.query<{ send_id: string }>(
      `insert into content.send (asset_id, entity_id, vehicle_id, instrument, status, requested_by, refusal)
       values ($1,$2,$3,$4::pipeline.instrument,$5::content.send_status,$6,$7)
       returning send_id`,
      [args.assetId, args.entityId, args.vehicleId, args.instrument,
       check.allowed ? 'proposed' : 'refused', actorId,
       check.allowed ? null : check.refusals.join(' ')],
    );
    const sendId = rows[0]!.send_id;

    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'send', $3, $4)`,
      [actorId, check.allowed ? 'send.proposed' : 'send.refused', sendId,
       JSON.stringify({ asset: asset.title, entity: entity.display_name, vehicle: vehicle.name,
                        instrument: args.instrument, refusals: check.refusals })],
    );

    if (!check.allowed) return { sendId, ticketId: null, check };

    const ticketId = await openTicket(
      actorId,
      {
        kind: 'SEND',
        subjectType: 'send',
        subjectId: sendId,
        subjectLabel: `${asset.title} → ${entity.display_name}`,
        scope: {
          authorizes:
            `Sending ${asset.title} (v${asset.version}) to ${entity.display_name} on behalf of ` +
            `${vehicle.name}, and to nobody else.`,
          excludes: [
            'Forwarding rights',
            'Any other variant of this asset',
            'Any statement about another vehicle',
          ],
          basis: [
            { label: 'Wrap check', value: `Passed — ${vehicle.exemption} × ${args.instrument}` },
            { label: 'Permitted use', value: asset.permittedUse },
            { label: 'Claims underneath', value: `${asset.claims.length}, none flagged for refresh` },
          ],
          apply: { command: 'content.recordSend', args: { sendId } },
        },
        vehicleId: args.vehicleId,
        expiresInDays: 3,
      },
      tx,
    );
    await tx.query('update content.send set ticket_id = $2 where send_id = $1', [sendId, ticketId]);
    return { sendId, ticketId, check };
  });
}

/** Fails closed without an approved SEND ticket, and re-runs the wrap check. */
export async function recordSend(actorId: string, sendId: string, ticketId: string | null): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await requireApprovedTicket(tx, {
      kind: 'SEND', subjectType: 'send', subjectId: sendId, ticketId,
    });
    const row = await tx.one<{ asset_id: string; vehicle_id: string; instrument: string; status: string }>(
      'select asset_id, vehicle_id, instrument::text as instrument, status::text as status from content.send where send_id = $1',
      [sendId],
    );
    if (!row) throw new Error(`No send ${sendId}`);
    if (row.status === 'sent') return;

    const asset = await getAsset(row.asset_id, tx);
    const vehicle = await tx.one<{ exemption: string }>(
      'select exemption from platform.vehicle where id = $1', [row.vehicle_id],
    );
    const check = await checkWrap({
      exemption: vehicle!.exemption, instrument: row.instrument,
      audience: asset!.audience, permittedUse: asset!.permittedUse,
    });
    if (!check.allowed || asset!.flags.length > 0) {
      throw new Error(
        'The wrap check no longer passes, or a claim underneath the asset changed since ' +
        `approval. Nothing was sent. ${check.refusals.join(' ')}`,
      );
    }

    await tx.query(
      "update content.send set status = 'sent', sent_at = now() where send_id = $1",
      [sendId],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'send.sent', 'send', $2, $3)`,
      [actorId, sendId, JSON.stringify({ asset: asset!.title })],
    );
  });
}

/**
 * Lineage invalidation. When a claim changes, every asset resting on it is marked for
 * refresh — the thing that makes a deck wrong is usually a changed fact, not elapsed time.
 */
export async function invalidateForClaim(claimId: string, reason: string): Promise<number> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const assets = await tx.query<{ asset_id: string }>(
      'select asset_id from content.claim_ref where claim_id = $1', [claimId],
    );
    // Derivatives of a flagged canonical asset are flagged too: the lineage is transitive.
    const all = new Set(assets.map((a) => a.asset_id));
    for (const a of assets) {
      const children = await tx.query<{ asset_id: string }>(
        'select asset_id from content.asset where parent_id = $1', [a.asset_id],
      );
      for (const c of children) all.add(c.asset_id);
    }
    for (const assetId of all) {
      await tx.query(
        `insert into content.refresh_flag (asset_id, claim_id, reason) values ($1,$2,$3)`,
        [assetId, claimId, reason],
      );
      await tx.query(
        `update content.asset set status = 'needs_refresh'
          where asset_id = $1 and status = 'approved'`,
        [assetId],
      );
    }
    return all.size;
  });
}
