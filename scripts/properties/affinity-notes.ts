import type { AffinityContext } from './affinity-fixtures';

export async function affinityNotesProperties(ctx: AffinityContext) {
  const { check, adb, KEY, scripted, sleep, ok } = ctx;
  // Every note, once (N49): the bulk read, on the fake Affinity and on scripted ones.
  const nt = await import('../../lib/connectors/affinity/notes');
  const sentNotes = async () => Number((await adb.one<{ n: string }>(`select count(*)::text as n from sources.request_log where outcome = 'sent' and endpoint = '/v2/notes'`))!.n);

  const before = await sentNotes();
  const heldRead = await nt.readNotes(null, { ceiling: 1 });
  check(
    'A notes read over what is allowed holds after one request, the count, and reads no note',
    heldRead?.status === 'held' && heldRead.requests === 1 && (await sentNotes()) - before === 1 && heldRead.records === 0,
    `status ${heldRead?.status}; ${heldRead?.requests} request; ${heldRead?.note}`,
  );

  const first = await nt.readNotes(null, { approvedUpTo: 3 });
  const landed = await adb.one<{ n: string; previews: string }>(
    `select count(distinct source_id)::text as n, count(*) filter (where payload ? 'personsPreview' and payload ? 'repliesCount')::text as previews
             from sources.raw_record where kind = 'note'`,
  );
  const fd = (first?.detail ?? {}) as { mode?: string; estimate?: number; withReplies?: number };
  check(
    'Every note is read in bulk — counted first, each with what it is attached to, replies counted and left',
    first?.status === 'ok' && fd.mode === 'full' && first.requests === 2 && fd.estimate === 2 &&
      Number(landed!.n) === 17 && Number(landed!.previews) === 17 && fd.withReplies === 1,
    `${first?.status}: ${first?.note}; ${first?.requests} requests for ${landed!.n} notes, ${landed!.previews} with their attachments`,
  );

  const second = await nt.readNotes(null);
  const sd = (second?.detail ?? {}) as { mode?: string; since?: string };
  check(
    'After a complete read, the next asks only for what changed since, less a day — here, nothing',
    second?.status === 'ok' && sd.mode === 'since' && !!sd.since && second.requests === 2 && second.records === 0 && second.newRecords === 0,
    `${second?.status}: mode ${sd.mode} since ${sd.since}; ${second?.requests} requests, ${second?.records} notes`,
  );

  // An Affinity that counts 150 notes but keeps paging, and whose next page drops `includes`.
  const s10 = scripted((u, i) => {
    if (u.searchParams.get('limit') === '0') return ok({ data: [], pagination: { totalCount: 150, nextUrl: null } });
    const note = { id: 91000 + i, type: 'entities', content: { html: `<p>n${i}</p>` }, creator: null, mentions: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: null };
    return ok({ data: [note], pagination: { nextUrl: `https://api.affinity.co/v2/notes?cursor=c${i}` } });
  });
  const capped = await nt.readNotes(null, { full: true, approvedUpTo: 4, overrides: { transport: s10.transport, key: KEY, sleep } });
  const pages = s10.calls.filter((u) => u.searchParams.get('limit') !== '0');
  const withIncludes = pages.every((u) => u.searchParams.getAll('includes').length === 4);
  check(
    'A notes read stops at the number approved, and every page asks for the attachments again',
    capped?.status === 'failed' && capped.requests === 4 && pages.length === 3 && withIncludes && /Stopped at 4 requests/.test(capped.note ?? ''),
    `status ${capped?.status}; ${capped?.requests} requests of 4 approved; ${pages.length} pages, includes on each: ${withIncludes}`,
  );
  await adb.query(`delete from sources.raw_record where kind = 'note' and source_id like '91%'`);

  // The calendar (N54): read in bulk under a cap, since the window, then only what changed.
  const mt = await import('../../lib/connectors/affinity/meetings');
  const cal = await mt.readMeetings(null);
  const cal2 = await mt.readMeetings(null);
  const s11 = scripted((u, i) => ok({ data: [{ id: 92000 + i, title: null, startTime: '2026-01-01T00:00:00Z', endTime: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null, attendeesPreview: { data: [], totalCount: 0 } }], pagination: { nextUrl: `https://api.affinity.co/v2/meetings?cursor=m${i}` } }));
  const capped2 = await mt.readMeetings(null, { full: true, cap: 3, overrides: { transport: s11.transport, key: KEY, sleep } });
  const windowed = s11.calls[0]?.searchParams.get('filter') ?? '';
  check(
    'The calendar is read in bulk from its window, then only what changed, and stops at its cap',
    cal?.status === 'ok' && cal.records === 11 && cal.requests === 1 && cal2?.status === 'ok' && cal2.newRecords === 0 &&
      (cal2.detail as { mode?: string }).mode === 'since' && capped2?.status === 'failed' && capped2.requests === 3 &&
      (capped2.detail as { stoppedAtCap?: boolean }).stoppedAtCap === true && windowed.startsWith('startTime>='),
    `first read ${cal?.records} meetings in ${cal?.requests} request; second ${cal2?.newRecords} new (${(cal2?.detail as { mode?: string })?.mode}); capped read ${capped2?.status} at ${capped2?.requests} requests; window filter "${windowed}"`,
  );
  await adb.query(`delete from sources.raw_record where kind = 'meeting' and source_id like '92%'`);
}

export async function translatedNotesProperties(ctx: AffinityContext) {
  const { check, adb } = ctx;
  const nt = await import('../../lib/connectors/affinity/notes');
  const who = await adb.one<{ entity_id: string }>(`select entity_id from identity.source_record where source = 'affinity' and source_id = 'person:7001'`);
  const about = who ? await nt.notesAbout(who.entity_id) : [];
  const newestFirst = about.every((x, i) => i === 0 || x.createdAt <= about[i - 1]!.createdAt);
  check(
    'An LP’s page shows the notes attached to them, newest first, with health detail flagged',
    about.length === 3 && about[0]!.noteId === 30002 && about.filter((x) => x.health).length === 1 && newestFirst &&
      about.some((x) => x.kind === 'interaction:meeting'),
    `${about.length} notes: ${about.map((x) => `${x.noteId}${x.health ? ' (health)' : ''} ${x.kind}`).join(', ')}`,
  );
}
