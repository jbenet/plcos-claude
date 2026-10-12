'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { appendAudit } from '@/modules/platform';
import type { AstraCommandOp, AstraWorkflow } from '@/lib/astra/jobs';

/**
 * Developer → Astra (docs/30-astra-runner.md): a person queues, cancels and schedules the Mac runner's Astra runs.
 * The server only records them; the runner on the Mac claims and launches. Admin only, like every runner setting.
 */
type State = { error?: string; message?: string };
const num = (form: FormData, key: string) => Number(form.get(key));

export async function queueAstraAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireAction('app/dev/astra/actions.ts#queueAstraAction', _prev, form);
  const { enqueue } = await import('@/lib/astra/jobs');
  try {
    const n = await enqueue(await getDb(), user.id, { workflow: String(form.get('workflow')) as AstraWorkflow, size: num(form, 'size'),
      count: num(form, 'count'), runNow: form.get('when') === 'now' });
    await appendAudit({ actorId: user.id, action: 'astra.queue', subjectType: 'astra_job', subjectId: null, detail: { count: n, workflow: String(form.get('workflow')), now: form.get('when') === 'now' } });
    revalidatePath('/dev/astra');
    return { message: `${n} run${n === 1 ? '' : 's'} queued${form.get('when') === 'now' ? '; the runner starts them on its next poll' : ' for tonight'}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The runs were not queued.' };
  }
}

export async function cancelAstraAction(form: FormData): Promise<void> {
  const user = await requireAction('app/dev/astra/actions.ts#cancelAstraAction', form);
  const { cancel, cancelQueued } = await import('@/lib/astra/jobs');
  const id = String(form.get('id') ?? '');
  const db = await getDb();
  if (id === 'queued') await cancelQueued(db);
  else if (/^[0-9a-f-]{36}$/i.test(id)) await cancel(db, id);
  await appendAudit({ actorId: user.id, action: 'astra.cancel', subjectType: 'astra_job', subjectId: null, detail: { which: id === 'queued' ? 'all queued' : 'one' } });
  revalidatePath('/dev/astra');
}

export async function astraSettingsAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireAction('app/dev/astra/actions.ts#astraSettingsAction', _prev, form);
  const { saveSettings } = await import('@/lib/astra/jobs');
  try {
    const settings = form.get('pause') !== null ? { paused: form.get('pause') === '1' } : {
      autoOn: form.get('autoOn') === 'on', autoWorkflow: String(form.get('autoWorkflow')) as AstraWorkflow, autoBatches: num(form, 'autoBatches'),
      batchSize: num(form, 'batchSize'), windowStart: num(form, 'windowStart'), windowEnd: num(form, 'windowEnd'),
    };
    await saveSettings(await getDb(), user.id, settings);
    await appendAudit({ actorId: user.id, action: 'astra.settings', subjectType: 'astra_runner', subjectId: null, detail: settings });
    revalidatePath('/dev/astra');
    return { message: 'paused' in settings ? (settings.paused ? 'Paused: the runner starts nothing new.' : 'Resumed.') : 'Saved.' };
  } catch {
    return { error: 'Not saved: check the numbers (batches 1–12, batch size 1–20, hours 0–23).' };
  }
}

/** Check, Restart or Update the Mac runner: it takes the command on its next poll (Restart and Update wait for running batches). */
export async function astraCommandAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireAction('app/dev/astra/actions.ts#astraCommandAction', _prev, form);
  const { issueCommand, COMMAND_LABEL } = await import('@/lib/astra/jobs');
  const op = String(form.get('op')) as AstraCommandOp;
  try {
    const { existing } = await issueCommand(await getDb(), user.id, op);
    await appendAudit({ actorId: user.id, action: 'astra.command', subjectType: 'astra_runner', subjectId: null, detail: { op, existing } });
    revalidatePath('/dev/astra');
    return { message: existing ? `${COMMAND_LABEL[op]} is already waiting for the runner.` : `${COMMAND_LABEL[op]} sent; the runner takes it on its next poll.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not sent.' };
  }
}

/** Night plan: Keep busy, and the steps the server works through in the window (migration 027). */
export async function astraPlanAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireAction('app/dev/astra/actions.ts#astraPlanAction', _prev, form);
  const { parsePlan, saveSettings } = await import('@/lib/astra/jobs');
  try {
    const plan = parsePlan(String(form.get('plan') ?? ''));
    const keepBusy = form.get('keepBusy') === 'on';
    await saveSettings(await getDb(), user.id, { keepBusy, plan });
    await appendAudit({ actorId: user.id, action: 'astra.plan', subjectType: 'astra_runner', subjectId: null, detail: { keepBusy, steps: plan.length } });
    revalidatePath('/dev/astra');
    return { message: keepBusy ? `Saved: ${plan.length} step${plan.length === 1 ? '' : 's'}, worked in order through the night window.` : 'Saved; Keep busy is off.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not saved.' };
  }
}
