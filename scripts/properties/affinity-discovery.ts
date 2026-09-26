import { affinitySliceProperties } from './affinity-slice';
import type { AffinityContext } from './affinity-fixtures';

export async function affinityDiscoveryProperties(ctx: AffinityContext) {
  const { check, adb, aff, KEY, scripted, sleep, ok } = ctx;
  const disc = await import('../../lib/connectors/affinity/discover');
  const first = await disc.discoverLists(null);
  const rows1 = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record`);
  const second = await disc.discoverLists(null);
  const rows2 = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record`);
  check(
    'Discovery lands raw once: running it again stores nothing new',
    first?.status === 'ok' && second?.status === 'ok' && first.newRecords > 0 && second.newRecords === 0 && rows1!.n === rows2!.n,
    `first run: ${first?.newRecords} new of ${first?.records}; second: ${second?.newRecords} new; raw rows ${rows1!.n} → ${rows2!.n}`,
  );

  const match = await import('../../lib/connectors/affinity/match');
  const found = await disc.discovered();
  const init = await disc.initForMatching();
  const m = match.matchLists(init!, found.lists);
  const got = (slug: string) => m.find((x) => x.vehicleSlug === slug)!;
  check(
    'A list name matches across dashes and case; a near miss is a suggestion, never a match',
    got('neurotech').list?.id === 101 && got('spv-cortex').list?.id === 103 &&
      got('rails').list === null && got('rails').closest?.list.id === 102,
    `hyphen for em dash: ${got('neurotech').list ? 'matched' : 'missed'}; en for em dash: ${got('spv-cortex').list ? 'matched' : 'missed'}; a word left out: ${got('rails').list ? 'MATCHED' : `suggests "${got('rails').closest?.list.name}"`}`,
  );

  {
    // One list whose fields Affinity refuses must not leave every other list undescribed.
    const lists = [{ id: 1, name: 'Open', creatorId: 1, ownerId: 1, isPublic: true, type: 'company', createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'Guarded', creatorId: 1, ownerId: 1, isPublic: false, type: 'company', createdAt: '2026-01-01T00:00:00Z' }];
    const s7 = scripted((u) => {
      if (u.pathname === '/v2/lists') return ok({ data: lists, pagination: { nextUrl: null } });
      if (u.pathname === '/v2/lists/2/fields') return { status: 403, body: { errors: [{ message: 'Forbidden' }] } };
      if (u.pathname === '/v2/lists/1/fields') return ok({ data: [{ id: 'field-1', name: 'Stage', type: 'list', enrichmentSource: null, valueType: 'dropdown', createdAt: null }], pagination: { nextUrl: null } });
      return ok();
    });
    const run = await disc.discoverLists(null, { transport: s7.transport, key: KEY, sleep });
    check(
      'A list Affinity will not describe is reported, and the rest are still read',
      run?.status === 'ok' && /fields unavailable for 1 \(Guarded: 403\)/.test(run.note ?? '') && /1 fields/.test(run.note ?? ''),
      `status ${run?.status}; ${run?.note}`,
    );
  }

  await affinitySliceProperties(ctx);

  const slug = aff.allowed('/v2/lists/12/fields/field-1234/dropdown-options');
  const sneaky = ['/v2/lists/12/fields/field.1/dropdown-options', '/v2/lists/12/fields/Field-1/dropdown-options', '/v2/lists/x1/fields'].filter((p) => aff.allowed(p));
  check(
    'A field id may be a slug, and nothing else passes in an id position',
    slug !== null && sneaky.length === 0,
    `field-1234 allowed: ${slug !== null}; odd ids let through: ${sneaky.length ? sneaky.join(', ') : 'none'}`,
  );
}
