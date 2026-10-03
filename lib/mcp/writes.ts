import { join } from 'node:path';
import { config } from '@/config/deployment';
import { feedbackHome } from '@/config/ports';
import { AuthorizationError } from '@/lib/authz';
import { authorizeAction } from '@/lib/authz/server';
import { getDb } from '@/lib/db';
import { textToDoc } from '@/lib/email/doc';
import { checkReport, journal } from '@/lib/feedback-inbox';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { newRequestKey } from '@/lib/request-key';
import { circuitBreaker } from '@/modules/agents';
import { createDraft, draftWithChecks, saveDraft, DraftRefused } from '@/modules/email';
import { listVehicles } from '@/modules/platform';
import type { Envelope } from './envelope';
import type { Answer } from './output';
import { resolveVehicle, ToolRefused } from './reads';

/**
 * The MCP write tools (docs/26-mcp.md). They draft and file; none sends, accepts, approves or moves
 * anything. Each one passes the same checks as the same act in the UI: the data profile (real data
 * changes only on the live server), then the UI action's own authorization rule, then the service,
 * which writes its own audit entry.
 */

async function gate(env: Envelope) {
  requireMutationProfile();
  // AGENTS.md: past the correction budget, new agent autonomy freezes. A draft is small, but it is
  // an agent writing, so it waits too.
  const breaker = await circuitBreaker();
  if (breaker.frozen) throw new ToolRefused(breaker.statement);
  void env;
}

export async function createEmailDraft(env: Envelope, a: {
  purpose: 'first_message' | 'intro_ask'; pursuitId?: string; vehicle?: string; entityId?: string; connectorId?: string;
  subject?: string; body?: string; to?: string;
}): Promise<Answer> {
  await gate(env);
  const user = env.principal;
  let vehicleId: string | null = null;
  if (a.vehicle) vehicleId = (await resolveVehicle(user, a.vehicle)).id;
  if (!a.pursuitId && !vehicleId) throw new ToolRefused('Name the LP (pursuitId), or the vehicle and the person or organisation (vehicle, entityId).');
  if (a.purpose === 'intro_ask' && (!a.connectorId || !(a.entityId || a.pursuitId))) throw new ToolRefused('An intro ask needs the connector (connectorId) and the LP (pursuitId or entityId).');
  const input = { purpose: a.purpose, vehicleId: vehicleId ?? '', pursuitId: a.pursuitId ?? '', entityId: a.entityId ?? '', connectorId: a.connectorId ?? '' };
  // The UI's own rule for this act (lib/authz/rules.ts): the vehicle comes from the persisted pursuit.
  try {
    await authorizeAction(user, 'app/email/actions.ts#createDraftAction', [{ ...input, vehicleId: vehicleId ?? undefined, pursuitId: a.pursuitId || undefined }], await getDb());
  } catch (e) {
    if (e instanceof AuthorizationError) throw new ToolRefused('You may not write drafts for that LP or vehicle.');
    throw e;
  }
  const actor = env.owner;
  try {
    if (!vehicleId) {
      const db = await getDb();
      vehicleId = (await db.one<{ v: string }>('select vehicle_id::text v from strategy.pursuit where pursuit_id = strategy.canonical_pursuit_id($1::uuid)', [a.pursuitId]))!.v;
    }
    const draftId = await createDraft(actor, {
      purpose: a.purpose, vehicleId, pursuitId: a.pursuitId || null, entityId: a.entityId || null, connectorId: a.connectorId || null,
    });
    if (a.subject !== undefined || a.body !== undefined || a.to !== undefined) {
      const { draft } = await draftWithChecks(actor, draftId);
      await saveDraft(actor, draftId, {
        revision: draft.revision, to: a.to ?? draft.to.join(', '), cc: '', bcc: '', subject: a.subject ?? draft.subject,
        mode: 'rich', doc: a.body !== undefined ? textToDoc(a.body) : draft.doc,
      });
    }
    const { draft, warnings, blocks } = await draftWithChecks(actor, draftId);
    const vehicle = (await listVehicles()).find((v) => v.id === draft.vehicleId)!;
    return {
      link: draft.pursuitId ? `/${vehicle.slug}/pipeline/${draft.pursuitId}#email` : `/${vehicle.slug}/routes?target=${draft.entityId ?? ''}`,
      data: {
        draftId, status: draft.status, purpose: draft.purpose, vehicle: vehicle.slug, lp: draft.entityName, connector: draft.connectorName,
        // The words you gave come back; words filled in from the records (a strategy's angle, which may rest on
        // licensed data) stay in the app, where its owner reviews them.
        subject: draft.subject, body: a.body !== undefined ? draft.bodyText : undefined,
        prefilledFrom: a.body === undefined ? draft.prefill?.source ?? null : null,
        // The address on record is filled in from the research; it is not echoed unless you gave it.
        to: a.to !== undefined ? draft.to : undefined, recipients: draft.to.length,
        warnings: warnings.map((w) => ({ level: w.level, rule: w.rule, text: w.text })),
        blocks: blocks.map((b) => ({ field: b.field, text: b.text })),
        next: 'The draft is saved in Capital OS only. Its owner opens it from the link, reviews it, and moves it to their own Gmail Drafts with a click; they send it from Gmail. Nothing was sent.',
      },
    };
  } catch (e) {
    if (e instanceof DraftRefused) throw new ToolRefused(e.message);
    throw e;
  }
}

export async function fileFeedback(env: Envelope, a: { title: string; body?: string; kind?: string; priority?: string; page?: string }): Promise<Answer> {
  // The feedback box's rule (app/api/feedback/route.ts): only the live app files, so issue numbers never collide.
  if (!feedbackHome(config.data.profile).filesHere) {
    throw new ToolRefused('This server runs a branch in development. Feedback is filed from the live app, so issue numbers never collide (docs/COLLAB.md).');
  }
  const checked = checkReport({ title: a.title, body: a.body ?? '', kind: a.kind, priority: a.priority, page: a.page ?? '/', context: { via: 'mcp', tokenId: env.tokenId } });
  if (!checked.ok) throw new ToolRefused(checked.error);
  const clientId = newRequestKey();
  // Journaled like the box; the ingester files it and resolves the reporter against the roster.
  await journal(join(process.cwd(), config.issues.dir), {
    kind: 'issue', clientId, receivedAt: new Date().toISOString(), reporter: env.owner.handle, request: checked.value,
  });
  setImmediate(() => { void import('@/lib/feedback-ingest').then((m) => m.kickIngest()).catch(() => undefined); });
  return { data: { journaled: true, clientId, next: 'Filed as an issue in a moment; it appears on Developer → Issues.' }, link: '/developer/issues' };
}
