import { getDb } from '@/lib/db';
import { setNextStep } from './service';

/**
 * Suggested strategies (N64, strategy 006): proposed by the enrichment workflows, decided by a
 * person. Accepting makes the suggestion's next action the pursuit's next step, in one write with
 * the decision; dismissing records that a person said no. Neither touches the status, the ladder
 * or money, and nothing is sent.
 */
export interface Suggestion {
  suggestionId: string;
  pursuitId: string;
  body: string;
  data: Record<string, unknown>;
  madeBy: string;
  madeAt: Date;
  status: 'proposed' | 'accepted' | 'dismissed' | 'withdrawn';
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export async function suggestionsFor(pursuitId: string): Promise<Suggestion[]> {
  const db = await getDb();
  const rows = await db.query<{
    suggestion_id: string; pursuit_id: string; body: string; data: Record<string, unknown>; made_by: string; made_at: Date | string;
    status: Suggestion['status']; name: string | null; decided_at: Date | string | null; decision_note: string | null;
  }>(
    `select s.suggestion_id::text, s.pursuit_id::text, s.body, s.data, s.made_by, s.made_at, s.status, u.name, s.decided_at, s.decision_note
       from strategy.suggestion s left join platform.app_user u on u.id = s.decided_by
      where s.pursuit_id = $1 and s.status <> 'withdrawn'
      order by s.created_at desc`,
    [pursuitId],
  );
  return rows.map((r) => ({
    suggestionId: r.suggestion_id, pursuitId: r.pursuit_id, body: r.body, data: r.data ?? {}, madeBy: r.made_by,
    madeAt: new Date(r.made_at), status: r.status, decidedByName: r.name, decidedAt: r.decided_at ? new Date(r.decided_at) : null,
    decisionNote: r.decision_note,
  }));
}

export class SuggestionRefused extends Error {
  constructor(message: string) { super(message); this.name = 'SuggestionRefused'; }
}

export async function decideSuggestion(actorId: string, suggestionId: string, decision: 'accept' | 'dismiss', note: string | null): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const s = await tx.one<{ pursuit_id: string; body: string; status: string }>(
      `select pursuit_id::text, body, status from strategy.suggestion where suggestion_id = $1 for update`, [suggestionId]);
    if (!s) throw new SuggestionRefused('No such suggestion.');
    if (s.status !== 'proposed') throw new SuggestionRefused(`Already ${s.status}; nothing changed.`);
    await tx.query(
      `update strategy.suggestion set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where suggestion_id = $1`,
      [suggestionId, decision === 'accept' ? 'accepted' : 'dismissed', actorId, note?.trim() || null],
    );
    if (decision === 'accept') {
      await setNextStep(actorId, s.pursuit_id, { nextStep: s.body.slice(0, 300), nextStepOn: null }, { q: tx });
    }
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'pursuit', $3, $4)`,
      [actorId, decision === 'accept' ? 'suggestion.accepted' : 'suggestion.dismissed', s.pursuit_id, JSON.stringify({ suggestionId, note: note?.trim() || null })],
    );
  });
}

/** Every open suggestion with its LP, for the portfolio view (N64, W8). */
export async function openSuggestions(): Promise<Array<Suggestion & { entityName: string; vehicleName: string; status: Suggestion['status'] }>> {
  const db = await getDb();
  const rows = await db.query<{
    suggestion_id: string; pursuit_id: string; body: string; data: Record<string, unknown>; made_by: string; made_at: Date | string;
    status: Suggestion['status']; entity_name: string; vehicle_name: string;
  }>(
    `select s.suggestion_id::text, s.pursuit_id::text, s.body, s.data, s.made_by, s.made_at, s.status,
            e.display_name as entity_name, v.name as vehicle_name
       from strategy.suggestion s
       join strategy.pursuit p on p.pursuit_id = s.pursuit_id
       join identity.entity e on e.entity_id = p.entity_id
       join platform.vehicle v on v.id = p.vehicle_id
      where s.status in ('proposed', 'accepted', 'dismissed')`,
  );
  return rows.map((r) => ({
    suggestionId: r.suggestion_id, pursuitId: r.pursuit_id, body: r.body, data: r.data ?? {}, madeBy: r.made_by, madeAt: new Date(r.made_at),
    status: r.status, decidedByName: null, decidedAt: null, decisionNote: null, entityName: r.entity_name, vehicleName: r.vehicle_name,
  }));
}

