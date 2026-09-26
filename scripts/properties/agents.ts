import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';

export async function agentsProperties({ check, db }: SeedContext) {
  const unpinnedRuns = await db.query<{ n: string }>(
    `select count(*)::text as n from agents.run
      where config_hash is null or input_hash is null or prompt_hash is null
         or config_snapshot is null`,
  );
  check(
    'Every agent run pins its config, input and prompt',
    Number(unpinnedRuns[0]!.n) === 0,
    `${unpinnedRuns[0]!.n} runs without a full pin`,
  );

  const looseCases = await db.query<{ n: string }>(
    'select count(*)::text as n from agents.eval_case where not protected or from_failure is null',
  );
  check(
    'Every eval case is protected and traceable to a real failure',
    Number(looseCases[0]!.n) === 0,
    `${looseCases[0]!.n} cases that are unprotected or invented`,
  );

}

export async function agentVariations(check: Check) {
  // Delegation cannot increase permission.
  {
    const d = await freshDb();
    const { createEnvelope, listEnvelopes, EnvelopeViolation } = await import('../../modules/agents');
    const parent = (await listEnvelopes())[0]!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    let refused = '';
    try {
      await createEnvelope(juan.id, {
        task: 'Draft and send the brief',
        scope: 'One target, one vehicle.',
        allowedEvidence: parent.allowedEvidence,
        allowedCommands: [...parent.allowedCommands, 'content.send'],
        budget: parent.budget,
        deadline: null,
        outputSchema: 'PrepBrief',
        acceptanceCriteria: parent.acceptanceCriteria,
        escalationOwnerId: juan.id,
        parentEnvelope: parent.envelopeId,
      });
    } catch (err) {
      refused = err instanceof EnvelopeViolation ? err.message : String(err);
    }
    check(
      'Variation — a child envelope asks for a command its parent lacks',
      refused.includes('cannot increase permission'),
      refused ? 'refused, and nothing was created' : 'NOT REFUSED — the child was created',
    );
    await d.close();
  }

  // A double click must not accept twice.
  {
    const d = await freshDb();
    const { acceptRun, listRuns } = await import('../../modules/agents');
    const run = (await listRuns())[0]!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const first = await acceptRun(juan.id, run.runId, 'accept:run:1', 'Looks right.');
    const second = await acceptRun(juan.id, run.runId, 'accept:run:1', 'Looks right.');
    const rows = await d.one<{ n: string }>('select count(*)::text as n from agents.acceptance');
    check(
      'Variation — accepting the same run twice',
      !first.alreadyAccepted && second.alreadyAccepted && Number(rows!.n) === 1,
      'the second call is a no-op and exactly one acceptance exists',
    );
    await d.close();
  }
}
