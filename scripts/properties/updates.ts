import type { AffinityContext } from './affinity-fixtures';

export async function updateProperties(ctx: AffinityContext & { n: (sql: string, params?: unknown[]) => Promise<number>; st: typeof import('../../modules/strategy'); juan: string }) {
  const { check, adb, attempt } = ctx;
  const { n, st, juan } = ctx;
  const today = '2026-09-24'; // a Thursday
  const read = (text: string, status: string) => st.readUpdate(text, { status: status as never, today });
  const kinds = (xs: ReturnType<typeof read>) => xs.map((x) => x.kind).join(',');
  const met = read('Met them Tuesday; they want the deck before a second meeting.', 'selected');
  const notMet = read("Haven't met yet.", 'selected');
  const inFor = read("They're in for $2M, verbally.", 'discussing');
  const boston = read('They are in Boston next week.', 'discussing');
  const declined = read('They passed — timing, next fund maybe.', 'discussing');
  const ours = read("We're passing for now.", 'discussing');
  const again = read('Met again today; still in.', 'committed');
  const wrote = read('Emailed Anneliese this morning to ask for twenty minutes.', 'selected');
  const theyWrote = read('They emailed yesterday, keen to talk.', 'connecting');
  const all = [met, notMet, inFor, boston, declined, ours, again, wrote, theyWrote].flat();
  const dir = (xs: ReturnType<typeof read>) => (xs.find((x) => x.kind === 'touch') as { direction?: string } | undefined)?.direction;
  const status = (xs: ReturnType<typeof read>) => xs.find((x) => x.kind === 'status') as { to: string; passedBy?: string; reason?: string } | undefined;
  const touch = met.find((x) => x.kind === 'touch') as { on: string; channel: string } | undefined;
  const readerOk =
    status(met)?.to === 'discussing' && touch?.on === '2026-09-22' && touch.channel === 'meeting' &&
    (met.find((x) => x.kind === 'next') as { step?: string } | undefined)?.step === 'Send the deck' &&
    notMet.length === 0 && status(inFor)?.to === 'committed' && inFor.some((x) => x.kind === 'amount') &&
    !status(boston) && status(declined)?.to === 'passed' && status(declined)?.passedBy === 'them' && status(declined)?.reason === 'timing' &&
    status(ours)?.passedBy === 'us' && !status(again) && again.some((x) => x.kind === 'touch') &&
    status(wrote)?.to === 'connecting' && dir(wrote) === 'ours' && status(theyWrote)?.to === 'discussing' && dir(theyWrote) === 'theirs' &&
    all.every((x) => ['status', 'touch', 'read', 'next', 'amount'].includes(x.kind) && x.basis.length > 0);
  check(
    'An update is read into suggestions, each resting on the words it quotes; forward only; never a rung, and an amount only pointed at',
    readerOk,
    `met Tuesday → ${kinds(met)} (${status(met)?.to}, ${touch?.on}); haven't met → ${kinds(notMet) || 'nothing'}; in for $2M → ${kinds(inFor)}; ` +
      `in Boston → ${kinds(boston) || 'nothing'}; passed on timing → ${status(declined)?.to}/${status(declined)?.passedBy}/${status(declined)?.reason}; we're passing → ${status(ours)?.passedBy}; ` +
      `met again, already committed → ${kinds(again)}; emailed someone by name → ${status(wrote)?.to}/${dir(wrote)}; they emailed → ${status(theyWrote)?.to}/${dir(theyWrote)}`,
  );

  // The audit log in words (N62, issue 0007): what a known action did, and to whom.
  const words = await import('../../lib/audit-words');
  const row = (action: string, detail: Record<string, unknown>) => ({ at: new Date(), action, subjectType: 'pursuit', subjectId: 'x', actor: 'Juan', detail });
  const said = [
    words.describeAudit(row('pursuit.status_set', { entity: 'Omar Haddad', vehicle: 'PLC Neurotech I', from: 'Selected', to: 'Discussing' })),
    words.describeAudit(row('ladder.climbed', { entity: 'Omar Haddad', vehicle: 'PLC Neurotech I', rungs: ['target_opted_in:calendar:x', 'meeting_held:calendar:x'] })),
    words.describeAudit(row('touchpoint.logged', { entity: 'Omar Haddad', vehicle: 'PLC Neurotech I', channel: 'email' })),
  ];
  const unknown = words.describeAudit(row('something.new_here', {}));
  check(
    'The audit log reads as sentences that name who and what; an action it does not know is shown by its name, not guessed',
    said[0]!.what === 'Juan set the status to Discussing, from Selected' && said[0]!.about === 'Omar Haddad · PLC Neurotech I' &&
      /LP opted in, Meeting held recorded on the ladder, approved by Juan/.test(said[1]!.what) && said[2]!.what === 'Juan logged an email' &&
      unknown.what === 'Juan · something new here',
    said.map((x) => `${x.what} — ${x.about}`).join('; ') + `; unknown: ${unknown.what}`,
  );

  const up = await import('../../lib/updates');
  const target = await adb.one<{ pursuit_id: string; status: string }>(
    `select p.pursuit_id::text, p.status::text from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id
              where v.phase <> 'historical' and p.status in ('new', 'sourcing', 'selected', 'connecting')
                and not exists (select 1 from strategy.ladder_event l where l.pursuit_id = p.pursuit_id
                                   and l.rung not in ('connector_willing', 'target_opted_in'))
                and not exists (select 1 from governance.approval_ticket t where t.subject_id = p.pursuit_id and t.kind = 'STAGE' and t.decision is null)
              order by p.opened_at limit 1`);
  if (!target) throw new Error('No pursuit below Meeting held without an open STAGE ticket, for the update property');
  const rungs0 = await n(`select count(*)::text as n from strategy.ladder_event`);
  const empty = await attempt(() => up.addUpdate(juan, { pursuitId: target!.pursuit_id, body: '   ', idempotencyKey: 'k-empty' }));
  const yesterday = new Date(Date.now() - 86_400_000);
  const input = {
    pursuitId: target!.pursuit_id, body: 'Met them yesterday; they want the deck.\nMore after the IC.', idempotencyKey: 'k-n61-1',
    status: { to: 'discussing' as const }, touch: { channel: 'meeting' as const, direction: 'both' as const, on: yesterday, read: 'interested' as const },
    nextStep: { step: 'Send the deck', on: null },
  };
  const saved = await up.addUpdate(juan, input);
  const twice = await up.addUpdate(juan, input);
  const after = await adb.one<{ status: string; status_source: string; status_reason: string; next_step: string }>(
    `select status::text, status_source, status_reason, next_step from strategy.pursuit where pursuit_id = $1`, [target!.pursuit_id]);
  const rows = await n(`select count(*)::text as n from strategy.pursuit_update where pursuit_id = $1`, [target!.pursuit_id]);
  const logged = await n(`select count(*)::text as n from meetings.meeting where pursuit_id = $1 and source = 'us' and summary like 'Met them yesterday%'`, [target!.pursuit_id]);
  const tied = await n(`select count(*)::text as n from platform.audit_log where subject_id = $1 and action = 'pursuit.status_set' and detail->>'updateId' = $2`, [target!.pursuit_id, saved.updateId]);
  const rungs1 = await n(`select count(*)::text as n from strategy.ladder_event`);
  const sysId = await (await import('../../lib/reconcile')).systemActor();
  const asked = await n(`select count(*)::text as n from governance.approval_ticket where subject_id = $1 and kind = 'STAGE' and decision is null and requested_by = $2`, [target!.pursuit_id, sysId]);
  const stored = (await st.updatesFor(target!.pursuit_id))[0];
  check(
    'An update writes its status, touchpoint and next step together, once per form, and never a rung; a meeting it logs is proposed for the ladder',
    empty instanceof st.StatusRefused && saved.created && !twice.created && twice.updateId === saved.updateId && rows === 1 && logged === 1 &&
      after?.status === 'discussing' && after.status_source === 'us' && after.status_reason === 'Met them yesterday; they want the deck.' &&
      after.next_step === 'Send the deck' && tied === 1 && rungs1 === rungs0 && saved.proposed && asked === 1 &&
      stored?.applied.status?.from === target!.status && stored.applied.touchpointId !== undefined && stored.suggested.reader === 'rules-1',
    `empty refused: ${empty instanceof st.StatusRefused}; saved ${saved.created}, again ${twice.created ? 'SAVED TWICE' : 'found the first'}; ${rows} update, ${logged} meeting logged; ` +
      `status ${target!.status} → ${after?.status} (${after?.status_source}), why "${after?.status_reason}", next "${after?.next_step}"; audit tied to the update: ${tied}; ` +
      `rungs ${rungs0} → ${rungs1}; ladder proposal from the system: ${asked}; reader pinned: ${stored?.suggested.reader}`,
  );
}
