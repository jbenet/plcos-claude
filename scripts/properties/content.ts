import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';

export async function contentProperties({ check, db }: SeedContext) {
  // Type, not behaviour. The wrap rules passed every behavioural check while
  // allowedAudiences was a raw string, because String.includes does substring matching and
  // no audience value happens to be a substring of another. The rules were right by luck.
  const { listWrapRules } = await import('../../modules/content');
  const wrapRules = await listWrapRules();
  check(
    'Wrap rules deserialize as real arrays, not array literals',
    wrapRules.length > 0 && wrapRules.every((r) => Array.isArray(r.allowedAudiences)),
    `${wrapRules.filter((r) => Array.isArray(r.allowedAudiences)).length} of ${wrapRules.length} ` +
    'parsed — this harness migrates and reads on one connection, which is the shape that breaks',
  );

  const { wrongWrapSends } = await import('../../modules/content');
  check(
    'Wrong-wrap sends = 0',
    (await wrongWrapSends()) === 0,
    'nothing has been sent under a wrap that refused it',
  );

  const ticketedRefusals = await db.query<{ n: string }>(
    "select count(*)::text as n from content.send where status = 'refused' and ticket_id is not null",
  );
  check(
    'A refused send never gets an approval ticket',
    Number(ticketedRefusals[0]!.n) === 0,
    `${ticketedRefusals[0]!.n} refused sends with a ticket`,
  );

}

export async function contentVariations(check: Check) {
  // The wrap matrix, end to end: a genuinely approved public primer, refused for a 506(b)
  // vehicle before any approval is requested.
  {
    const d = await freshDb();
    const { requestSend } = await import('../../modules/content');
    const asset = (await d.one<{ asset_id: string }>(
      "select asset_id from content.asset where title = 'Neurotech primer v4'",
    ))!;
    const halo = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'spv-halo'"))!;
    const target = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Jaramillo Family Trust'",
    ))!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;

    const out = await requestSend(juan.id, {
      assetId: asset.asset_id, entityId: target.entity_id, vehicleId: halo.id, instrument: 'spv',
    });
    check(
      'Variation — public primer for the 506(b) SPV',
      !out.check.allowed && out.ticketId === null && out.check.refusals.length === 2,
      `refused with ${out.check.refusals.length} reasons and no ticket opened — audience and ` +
      'permitted-use both fail, and both are reported',
    );
    await d.close();
  }

  // Lineage: superseding a claim flags every derivative, and a flagged asset cannot be sent.
  {
    const d = await freshDb();
    const { invalidateForClaim, requestSend } = await import('../../modules/content');
    const claim = (await d.one<{ claim_id: string }>(
      `select c.claim_id from research.claim c join content.claim_ref r on r.claim_id = c.claim_id
        limit 1`,
    ))!;
    const flagged = await invalidateForClaim(claim.claim_id, 'The cheque band changed after a call with the trustee.');

    const asset = (await d.one<{ asset_id: string }>(
      "select asset_id from content.asset where title = 'Neurotech primer v4'",
    ))!;
    const neuro = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'neurotech'"))!;
    const target = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Jaramillo Family Trust'",
    ))!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const out = await requestSend(juan.id, {
      assetId: asset.asset_id, entityId: target.entity_id, vehicleId: neuro.id, instrument: 'lp_commitment',
    });

    check(
      'Variation — a claim changes underneath an approved asset',
      flagged > 1 && !out.check.allowed,
      `${flagged} assets flagged transitively, and the send is refused: a deck goes wrong ` +
      'because a fact changed, not because time passed',
    );
    await d.close();
  }
}
