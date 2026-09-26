import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { AffinityContext } from './affinity-fixtures';

export async function affinityMappingProperties(ctx: AffinityContext & { report: Awaited<ReturnType<typeof import('../../lib/connectors/affinity/inventory').inventory>> }) {
  const { check } = ctx;
  const { report } = ctx;
  const map = await import('../../lib/connectors/affinity/mapping');
  const { impliedRung } = await import('../../modules/strategy');
  const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
  const file = join('data', 'demo', 'props-mapping.jsonc');
  await rm(join(process.cwd(), file), { force: true });
  await map.writeMapping(report, {}, file);
  const fresh = await map.readMapping(report, file);
  const lists = Object.values(fresh.lists);
  check(
    'The proposed mapping places what it can, leaves the rest a question, and says nobody has reviewed it',
    fresh.exists && fresh.problems.length === 0 && fresh.mapped > 0 && lists.every((l) => !l.reviewed) && lists.some((l) => l.status.length > 0),
    `${fresh.mapped} of ${fresh.values} values placed; ${lists.length} lists, none reviewed; problems ${fresh.problems.length}`,
  );

  // One field, taken apart (N50): a status, who and why where it ended, and what the word
  // says happened — which claims a rung and is never a ladder event.
  const pv = map.proposeValue;
  const twice = pv('Second meeting done');
  const signedWord = pv('Subscription signed');
  const quiet = pv('Lost: went dark');
  const held = pv('Paused — verbal yes');
  const holdAlone = pv('On Hold');
  const contacted = pv('Contacted');
  check(
    'A status word becomes a status and what it says happened; only the latter claims a rung',
    twice?.status === 'discussing' && !!twice.implies?.includes('met_twice') && impliedRung(twice.implies ?? []) === 'meeting_held' &&
      signedWord?.status === 'committed' && impliedRung(signedWord.implies ?? []) === 'commitment_accepted' &&
      quiet?.status === 'selected' && !!quiet.implies?.includes('reached_out') &&
      holdAlone?.status === 'passed' && holdAlone.passedBy === 'us' && holdAlone.reason === 'do_not_contact' &&
      held?.status === 'committed' && held.next === 'On hold' &&
      contacted?.status === 'connecting' && impliedRung(contacted.implies ?? []) === null,
    `second meeting → ${twice?.status} (${twice?.implies}); signed → ${signedWord?.status}, claims ${impliedRung(signedWord?.implies ?? [])}; lost, went dark → ${quiet?.status} (silence is not a pass); on hold alone → ${holdAlone?.status}, ${holdAlone?.reason}; paused, verbal → ${held?.status}, next "${held?.next}"; contacted claims ${impliedRung(contacted?.implies ?? []) ?? 'nothing'}`,
  );

  // A person edits it — marks a list reviewed, takes a meaning away — and it is regenerated.
  const text0 = await rf(join(process.cwd(), file), 'utf8');
  const edited = text0.replace('"reviewed": false', '"reviewed": true').replace(/("Signed":\s*)\{[^}]*\}/, '$1null');
  await wf(join(process.cwd(), file), edited);
  await map.writeMapping(report, {}, file);
  const kept = await map.readMapping(report, file);
  const first = Object.values(kept.lists)[0]!;
  const signed = first.status.flatMap((s) => Object.entries(s.values)).find(([k]) => k === 'Signed');
  check(
    'Regenerating the mapping keeps every edit, a null a person wrote included',
    first.reviewed && !!signed && signed[1] === null,
    `reviewed ${first.reviewed}; "Signed" → ${JSON.stringify(signed?.[1])}`,
  );

  await wf(join(process.cwd(), file), edited.replace('"status":"committed"', '"status":"won"'));
  const wrong = await map.readMapping(report, file);
  check(
    'A status that is not one of ours is refused by name, and left unplaced',
    wrong.problems.some((p) => /status "won" is not one this tool has/.test(p)),
    wrong.problems[0] ?? 'no problem reported',
  );

  // A file written in stages (before N50) still reads: as statuses, the unreviewed lists
  // re-proposed when it is next written.
  await wf(join(process.cwd(), file), text0.replace(/"status": \[/, '"stage": [').replace(/\{"status":"connecting","implies":\["reached_out"\]\}/g, '{"stage":"contacted"}'));
  const old = await map.readMapping(report, file);
  const oldContacted = Object.values(old.lists).flatMap((l) => l.status.flatMap((src) => Object.entries(src.values))).find(([k]) => k === 'Contacted');
  check(
    'A mapping written in stages reads as statuses',
    old.problems.length === 0 && Object.values(old.lists).some((l) => l.legacy) && oldContacted?.[1]?.status === 'connecting',
    `legacy lists ${Object.values(old.lists).filter((l) => l.legacy).length}; "Contacted" → ${JSON.stringify(oldContacted?.[1])}; problems ${old.problems.length}`,
  );
  await rm(join(process.cwd(), file), { force: true });
}
