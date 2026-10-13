'use server';
import { requireAction } from '@/lib/authz/server';

/**
 * Possible LPs from the calendar, on Pipeline → New (lib/calendar-candidates.ts). Nothing is added without one of these
 * clicks, and none of them writes to a calendar or emails anyone. No revalidatePath (as app/targets/bulk-actions.ts): the
 * caller refreshes the page itself.
 */

export type CandidateActionResult = { ok: true; message: string; pursuitId?: string } | { ok: false; error: string };

async function refused<T>(run: () => Promise<T>, done: (r: T) => CandidateActionResult): Promise<CandidateActionResult> {
  const { CandidateRefused } = await import('@/lib/calendar-candidates');
  try {
    return done(await run());
  } catch (e) {
    if (e instanceof CandidateRefused) return { ok: false, error: e.message };
    throw e;
  }
}

/** "Add as LP prospect": a pursuit in New for that vehicle, with the meetings as its touchpoints. */
export async function addCandidateAction(input: { key: string; vehicleId: string; requestKey: string; firmName?: string }): Promise<CandidateActionResult> {
  const user = await requireAction('app/targets/calendar-candidate-actions.ts#addCandidateAction', input);
  const { addCandidate } = await import('@/lib/calendar-candidates');
  const db = await (await import('@/lib/db')).getDb();
  return refused(() => addCandidate(db, user.id, input), (r) => ({ ok: true, pursuitId: r.pursuitId,
    message: `${r.created ? 'Added to New' : 'Already added'}, with ${r.meetings} ${r.meetings === 1 ? 'meeting' : 'meetings'} from the calendar.` }));
}

/** Undo an "Add as LP prospect", while nothing else is recorded on the pursuit. */
export async function undoCandidateAddAction(input: { pursuitId: string }): Promise<CandidateActionResult> {
  const user = await requireAction('app/targets/calendar-candidate-actions.ts#undoCandidateAddAction', input);
  const { undoCandidateAdd } = await import('@/lib/calendar-candidates');
  const db = await (await import('@/lib/db')).getDb();
  return refused(() => undoCandidateAdd(db, user.id, input.pursuitId), () => ({ ok: true, message: 'Undone: the pursuit and its calendar meetings are gone, and it is listed again.' }));
}

/** "Not an LP": remembered for good. */
export async function dismissCandidateAction(input: { key: string }): Promise<CandidateActionResult> {
  const user = await requireAction('app/targets/calendar-candidate-actions.ts#dismissCandidateAction', input);
  const { dismissCandidate } = await import('@/lib/calendar-candidates');
  const db = await (await import('@/lib/db')).getDb();
  return refused(() => dismissCandidate(db, user.id, input.key), () => ({ ok: true, message: 'Set aside as not an LP. No later calendar read lists it again.' }));
}

/** "Research": asks for the profile workflow on the firm by its public name; nothing runs. */
export async function researchCandidateAction(input: { key: string; requestKey: string }): Promise<CandidateActionResult> {
  const user = await requireAction('app/targets/calendar-candidate-actions.ts#researchCandidateAction', input);
  const { researchCandidate } = await import('@/lib/calendar-candidates');
  const db = await (await import('@/lib/db')).getDb();
  return refused(() => researchCandidate(db, user.id, input.key, input.requestKey), (r) => ({ ok: true,
    message: r.created ? 'Research asked for, by public name only. Saved for review on its timeline; nothing runs until someone starts it.' : 'Research is already asked for.' }));
}
