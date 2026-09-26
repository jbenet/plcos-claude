import { appendFile, mkdir, readFile, rename, writeFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Finding, Connection } from './schema';

export interface ConnectionFeedback {
  id: string;
  lp: string;
  page: string;
  text: string;
  author: { id: string; handle: string; name: string };
  at: string;
}
export const feedbackFile = (dir: string) => join(dir, 'feedback', 'connection-feedback.jsonl');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function feedbackInput(value: unknown): { id: string; lp: string; page: string; text: string } {
  if (!value || typeof value !== 'object') throw new Error('Enter connection feedback.');
  const x = value as Record<string, unknown>;
  if (typeof x.id !== 'string' || !uuid.test(x.id) || typeof x.lp !== 'string' || !uuid.test(x.lp)) throw new Error('Choose an LP and retry.');
  if (typeof x.text !== 'string' || !x.text.trim() || x.text.length > 5000) throw new Error('Enter between 1 and 5,000 characters.');
  if (typeof x.page !== 'string' || !/^\/(?:[a-z0-9-]+\/)?(?:routes|(?:targets|pipeline)\/[a-f0-9-]+|orgs\/[a-f0-9-]+)(?:\?[^\r\n]*)?$/i.test(x.page) || x.page.length > 1000) throw new Error('Feedback must come from the routes or LP page.');
  return { id: x.id, lp: x.lp, page: x.page, text: x.text.trim() };
}
async function lines<T>(path: string): Promise<T[]> {
  const text = await readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return ''; throw e; });
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
}
// The one server serializes intake; retries keep the same client key until a receipt arrives.
let intake = Promise.resolve();
export async function saveConnectionFeedback(dir: string, note: ConnectionFeedback): Promise<ConnectionFeedback> {
  const result = intake.then(async () => {
    await mkdir(join(dir, 'feedback'), { recursive: true });
    const previous = (await lines<ConnectionFeedback>(feedbackFile(dir))).find((x) => x.id === note.id);
    if (previous) {
      if (previous.lp !== note.lp || previous.text !== note.text || previous.page !== note.page || previous.author.id !== note.author.id) throw new Error('This feedback receipt belongs to a different note.');
      return previous;
    }
    await appendFile(feedbackFile(dir), `${JSON.stringify(note)}\n`, 'utf8');
    return note;
  });
  intake = result.then(() => {}, () => {});
  return result;
}

/** Only an unqualified statement about the selected LP can assert the author's own tie.
 * Third-party claims and ambiguous prose remain evidence for the next human/workflow review.
 * The statement date is a review date, never an invented date of last interaction.
 */
export function firstPersonTie(text: string): 'acquaintance' | 'worked_together' | null {
  const s = text.trim().replace(/[.!]$/, '').toLowerCase();
  if (/^i know (?:him|her|them)(?: directly| personally| well)?$/.test(s)) return 'acquaintance';
  if (/^(?:he|she|they) worked (?:at (?:pl|protocol labs) )?with (?:me|us)$/.test(s)
    || /^i worked with (?:him|her|them)(?: at (?:pl|protocol labs))?$/.test(s)) return 'worked_together';
  return null;
}

export function applyConnectionFeedback(finding: Finding, note: ConnectionFeedback): Finding {
  if (finding.key !== note.lp) throw new Error('Feedback and finding refer to different LPs.');
  if (finding.connectionFeedback?.some((x) => x.id === note.id)) return finding;
  const kind = firstPersonTie(note.text);
  const tie: Connection[] = kind ? [{ to: note.author.name, toHandle: note.author.handle,
    kind: kind === 'worked_together' ? 'colleague' : 'other', tier: 'B', scope: 'person',
    basis: note.text, source: `connection-feedback:${note.id}`, feedbackId: note.id,
    reviewedBy: note.author.handle, reviewedAt: note.at, tie: { kind } }] : [];
  return { ...finding,
    connectionFeedback: [...(finding.connectionFeedback ?? []), { id: note.id, text: note.text, page: note.page, author: note.author, at: note.at }],
    connections: [...(finding.connections ?? []), ...tie] };
}

/** Files only. Run before W3 + import; never opens the real database. A queue entry is a
 * research proposal, not authorization to launch a workflow or change another LP.
 */
export async function processConnectionFeedback(dir: string): Promise<{ processed: number; reviewed: number; queued: number }> {
  await mkdir(join(dir, 'feedback'), { recursive: true });
  const lockPath = join(dir, 'feedback', '.processing');
  const lock = await open(lockPath, 'wx');
  const counts = { processed: 0, reviewed: 0, queued: 0 };
  try {
    const notes = await lines<ConnectionFeedback>(feedbackFile(dir));
    const queueFile = join(dir, 'feedback', 'find-similar.jsonl');
    const queued = new Set((await lines<{ id: string }>(queueFile)).map((x) => x.id));
    const candidates = await lines<{ key: string; name: string }>(join(dir, 'candidates.jsonl'));
    for (const note of notes) {
      feedbackInput(note);
      if (!note.author?.id || !note.author.handle || !note.author.name || !Number.isFinite(Date.parse(note.at))) throw new Error('Invalid feedback author or time.');
      const path = join(dir, 'raw', `${note.lp}.json`);
      let finding: Finding;
      try { finding = JSON.parse(await readFile(path, 'utf8')) as Finding; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        const candidate = candidates.find((x) => x.key === note.lp);
        if (!candidate) throw new Error('Feedback LP has no finding or exported candidate; export the research set first.');
        finding = { key: note.lp, name: candidate.name, researched: { at: note.at, by: note.author.handle, workflow: 'W1', version: 'feedback', method: 'pages' },
          identity: { match: 'confirmed', basis: 'Selected existing LP record; connection feedback only, no public identity research.' }, facts: [],
          coverage: { searched: [], note: 'Team connection feedback only; public research has not run.' } };
      }
      const next = applyConnectionFeedback(finding, note);
      if (next !== finding) {
        await mkdir(join(dir, 'raw'), { recursive: true });
        const temporary = `${path}.feedback-tmp`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
        await rename(temporary, path);
        counts.processed++;
        if (firstPersonTie(note.text)) counts.reviewed++;
      }
      // Write after the finding. A retry repairs an interrupted queue append without duplicating evidence.
      if (!queued.has(note.id)) {
        await appendFile(queueFile, `${JSON.stringify({ id: note.id, lp: note.lp, kind: 'find_similar', status: 'queued', feedbackId: note.id, text: note.text, author: note.author, at: note.at })}\n`);
        queued.add(note.id); counts.queued++;
      }
    }
    return counts;
  } finally { await lock.close(); await unlink(lockPath); }
}
