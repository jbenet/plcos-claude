import { join } from 'node:path';
import type { AffinityContext } from './affinity-fixtures';

export async function readingProperties(ctx: AffinityContext & { n: (sql: string, params?: unknown[]) => Promise<number>; tr: typeof import('../../lib/connectors/affinity/translate'); file: string; juanId: string; mt: typeof import('../../modules/meetings') }) {
  const { check, adb } = ctx;
  const { n, tr, file, juanId, mt } = ctx;
  const rd = await import('../../lib/connectors/affinity/readings');
  const { shownRead } = await import('../../lib/reads');
  const entityOf = async (key: string) => (await adb.one<{ entity_id: string }>(`select entity_id from identity.source_record where source = 'affinity' and source_id = $1`, [key]))!.entity_id;
  const loaded = await n(`select count(*)::text as n from meetings.note_reading`);
  // The demo's health note has a line that says what it took out, so it loads (N56)...
  const redactedRow = await adb.one<{ summary: string }>(`select summary from meetings.note_reading where note_id = '30002'`);
  const { mentionsHealth } = await import('../../lib/connectors/affinity/inventory');
  const health = redactedRow && rd.REDACTED.test(redactedRow.summary) && !mentionsHealth(redactedRow.summary) ? 0 : 1;
  // ...and a line that doesn't say so, or still carries the detail, is refused.
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'readings-'));
  const rawNotes = (await adb.query<{ payload: import('../../lib/connectors/affinity/notes').AffinityNote }>(
    `select distinct on (source_id) payload from sources.raw_record where source = 'affinity' and kind = 'note' order by source_id, fetched_at desc, id desc`)).map((r) => r.payload);
  const refusedOf = async (line: object) => {
    const f = join(dir, `r${Math.random().toString(36).slice(2)}.jsonc`);
    await writeFile(f, JSON.stringify({ by: 'claude', at: '2026-09-23T00:00:00Z', notes: { '30002': line } }));
    return adb.transaction((tx) => rd.importReadings(tx, rawNotes, f));
  };
  const unmarked = await refusedOf({ summary: 'Slower on email this month.', read: 'interested', basis: 'not a signal about interest' });
  const leaky = await refusedOf({ summary: 'Slower on email; her husband is recovering from surgery [redacted].', read: null, basis: null });
  const stillClean = (await adb.one<{ summary: string }>(`select summary from meetings.note_reading where note_id = '30002'`))?.summary === redactedRow?.summary;
  const nadiaE = await entityOf('person:7001');
  const anaE = await entityOf('person:7004');
  const nadiaShown = shownRead(mt.summarize(await mt.touchpointsFor(nadiaE, null)).read, await rd.readingsFor([nadiaE]));
  const anaFirst = shownRead(null, await rd.readingsFor([anaE]));
  await rd.decideReading(juanId, '30003', 'dismiss');
  await tr.translate(null, { mappingPath: file });
  const anaAfter = shownRead(null, await rd.readingsFor([anaE]));
  const stillDismissed = await n(`select count(*)::text as n from meetings.note_reading where note_id = '30003' and dismissed_at is not null`);
  await rd.decideReading(juanId, '30008', 'confirm');
  const anaConfirmed = shownRead(null, await rd.readingsFor([anaE]));
  check(
    'A read suggested from a note never outranks a newer one a person took, reads health only redacted, and a dismissal lasts',
    loaded === 15 && health === 0 && unmarked.health === 1 && unmarked.loaded === 0 && leaky.health === 1 && leaky.loaded === 0 && stillClean &&
      nadiaShown?.suggested === false && nadiaShown.read === 'very_interested' &&
      anaFirst?.suggested === true && anaFirst.noteId === '30003' && anaAfter?.noteId === '30008' && stillDismissed === 1 &&
      anaConfirmed?.suggested === false && anaConfirmed.byName === 'Lior',
    `loaded ${loaded} (the health note's, redacted and marked: ${health === 0}; unmarked refused: ${unmarked.health === 1}; still carrying the detail refused: ${leaky.health === 1}); Thandiwe shows ${nadiaShown?.read} by ${nadiaShown?.byName}; Elif suggested ${anaFirst?.noteId} → after dismissing, ${anaAfter?.noteId}, still dismissed after translating again: ${stillDismissed === 1}; confirmed → ${anaConfirmed?.read} by ${anaConfirmed?.byName}`,
  );
}
