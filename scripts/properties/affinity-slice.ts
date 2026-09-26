import { affinityNotesProperties } from './affinity-notes';
import { affinityMappingProperties } from './affinity-mapping';
import { affinityTranslationProperties } from './affinity-translation';
import type { AffinityContext } from './affinity-fixtures';

export async function affinitySliceProperties(ctx: AffinityContext) {
  const { check, adb, aff, KEY, scripted, sleep, ok, attempt } = ctx;
  // The first slice (N42), on the fake Affinity, after the discovery above.
  const sl = await import('../../lib/connectors/affinity/slice');
  const held = await sl.runSlice(null, { ceiling: 1 });
  const heldAsked = await adb.one<{ n: string }>(
    `select count(*)::text as n from sources.request_log where outcome = 'sent' and endpoint like '%/relationships'`,
  );
  const estimate = Number((held?.detail as { estimate?: number }).estimate ?? 0);
  check(
    'Over the ceiling, the slice reads entries and holds the per-person reads for a go-ahead',
    held?.status === 'held' && estimate > 0 && Number(heldAsked!.n) === 0,
    `status ${held?.status}; estimate ${estimate}; relationships asked while held: ${heldAsked!.n}`,
  );

  const done = await sl.runSlice(null, { ceiling: 1, approvedUpTo: Math.ceil(estimate * 1.25) });
  const perEntry = await adb.one<{ n: string }>(
    `select count(*)::text as n from sources.request_log where outcome = 'sent' and path ~ '^/v2/(persons|companies|opportunities)/[0-9]+/notes$'`,
  );
  const s9 = scripted(() => ok());
  const offList = await attempt(() => aff.affinity({ transport: s9.transport, key: KEY, sleep }).get('/v2/persons/7001/notes'));
  check(
    'The slice reads no note one entry at a time, and the per-entry note paths are off the allowlist',
    done?.status === 'ok' && Number(perEntry!.n) === 0 && offList instanceof aff.AffinityRefused && s9.calls.length === 0,
    `approved run: ${done?.status}; per-entry note requests ${perEntry!.n}; /v2/persons/7001/notes ${offList instanceof aff.AffinityRefused ? 'refused before sending' : 'ALLOWED'}`,
  );

  const again = await sl.runSlice(null, { approvedUpTo: 1000 });
  check(
    'A second slice stores nothing it already has',
    again?.status === 'ok' && again.newRecords === 0 && again.records > 0,
    `second run: ${again?.records} seen, ${again?.newRecords} new`,
  );

  await affinityNotesProperties(ctx);

  const inv = await import('../../lib/connectors/affinity/inventory');
  const flagged = ['Her husband is recovering from surgery.', 'Mentioned a death in the family.'].every(inv.mentionsHealth);
  const clean = ['Wants the data room before the IC.', 'Prefers the tax treatment of a feeder.', 'Closing conditions are met.'].every((t) => !inv.mentionsHealth(t));
  const namesHeld = inv.looksLikeNames('Organization (LP)', 30, 40) && inv.looksLikeNames('Referrer', 60, 70);
  const vocabShown = !inv.looksLikeNames('Pipeline stage', 14, 2000) && !inv.looksLikeNames('Do not contact', 1, 2) && !inv.looksLikeNames('Main contact at the firm?', 2, 50);
  check(
    'A dropdown of names is withheld from the inventory; a vocabulary is shown',
    namesHeld && vocabShown,
    `names withheld: ${namesHeld}; stage, do-not-contact and yes/no fields shown: ${vocabShown}`,
  );
  const report = await inv.inventory();
  const text = JSON.stringify(report);
  const outsiders = ['Nadia', 'Brandt', 'Vidal', 'Tanaka', 'Obi', 'surgery', 'data-room'].filter((w) => text.includes(w));
  const notes = report.notes;
  check(
    'The inventory flags health detail, names nobody outside the team, and sums no amount',
    flagged && clean && outsiders.length === 0 && notes?.health === 1 && !/"sum"|"total"/.test(text),
    `flagged ${flagged}; false alarms ${!clean}; outside names or note words in it: ${outsiders.join(', ') || 'none'}; health-flagged notes ${notes?.health}`,
  );

  await affinityMappingProperties({ ...ctx, report });

  await affinityTranslationProperties({ ...ctx, report });

  {
    const cmp = await import('../../lib/connectors/affinity/compare');
    const [c] = await cmp.compareLists();
    check(
      'An older list is checked against the one in use: who is covered, and who would be lost',
      !!c && c.total === 5 && c.byPerson === 3 && c.missing.length === 1 && c.missing[0]!.status === 'To Research' && c.unlinked.length === 1,
      c ? `${c.total} on the old list: ${c.byPerson} by person, ${c.byOrganization} by organization, ${c.missing.length} missing, ${c.unlinked.length} linked to nobody` : 'no comparison',
    );
  }

  {
    const sl2 = await import('../../lib/connectors/affinity/slice');
    const notesBefore = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record where kind = 'note'`);
    const counted = await sl2.countNotes(null);
    const notesAfter = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record where kind = 'note'`);
    const d = counted?.detail as { total?: number; bulkRequests?: number };
    check(
      'Counting the notes costs one request and lands none of them',
      counted?.status === 'ok' && d.total === 17 && d.bulkRequests === 1 && counted.requests === 1 && notesBefore!.n === notesAfter!.n,
      `${d.total} notes counted, a bulk read would be ${d.bulkRequests} requests; notes landed ${notesBefore!.n} → ${notesAfter!.n}`,
    );
  }

  {
    // A dropped connection is tried again; three in a row is an outage, and says why.
    let failures = 0;
    const flaky = {
      kind: 'scripted' as const,
      async get(url: URL) {
        if (url.pathname === '/v2/lists' && failures < 1) {
          failures++;
          throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        }
        if (url.pathname === '/v2/lists/9') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
        return { status: 200, headers: new Headers(ok().headers), text: async () => JSON.stringify({ data: [], pagination: { nextUrl: null } }) };
      },
    };
    const client = aff.affinity({ transport: flaky, key: KEY, sleep });
    const recovered = await attempt(() => client.get('/v2/lists'));
    const down = await attempt(() => client.get('/v2/lists/9'));
    const tries = await adb.query<{ note: string }>(`select note from sources.request_log where outcome = 'network_error' and path = '/v2/lists/9' order by id`);
    check(
      'A network failure is tried again, and after three in a row the error names its cause',
      recovered === null && down instanceof aff.AffinityError && /ENOTFOUND/.test(down.message) && tries.length === 3 && /trying again/.test(tries[0]!.note),
      `first read after a dropped connection: ${recovered ? recovered.message : 'ok'}; outage: ${down?.message}; attempts logged ${tries.length}`,
    );
  }

  const s8 = scripted(() => ok());
  await aff.affinity({ transport: s8.transport, key: KEY, sleep }).get('/v2/lists/1/list-entries', { limit: 100, fieldTypes: ['list', 'global'] });
  const sentTypes = s8.calls[0]?.searchParams.getAll('fieldTypes') ?? [];
  check(
    'A list parameter goes out repeated, the way Affinity asks for several field types',
    sentTypes.join(',') === 'list,global',
    `fieldTypes sent as: ${s8.calls[0]?.search ?? 'nothing'}`,
  );
}
