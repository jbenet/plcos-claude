import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { withRoute } from '@/lib/authz/route';
import { config } from '@/config/deployment';
import { issues } from '@/lib/issues';
import { verifyRead, MAX_IDS } from '@/lib/feedback-signal';
import { FEEDBACK_SIGNAL_TOKEN_SETTING } from '@/lib/feedback-signal/setting';
import { settingsReady, settingValue } from '@/lib/settings/store';

/**
 * The feedback signal's read link (lib/feedback-signal, docs/deploy/04-feedback-signal.md §3): the issues a
 * signal named, to whoever holds the link, until it expires. `?file=` returns one of their attachments.
 * No cookie and no stored credential on the reader's side: the signature is the permission, and it covers
 * only those ids. Signal off (no token) or a preview copy: 404. Reads only.
 */
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

export const GET = withRoute('app/api/feedback/signal/route.ts#GET', async function(req: Request) {
  await settingsReady().catch(() => undefined);
  const token = config.data.copyTakenAt ? undefined : settingValue(FEEDBACK_SIGNAL_TOKEN_SETTING.key);
  if (!token) return new Response(null, { status: 404 });
  const q = new URL(req.url).searchParams;
  const ids = (q.get('ids') ?? '').split(',');
  if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => /^\d{4,6}$/.test(id))) {
    return Response.json({ error: 'Give ids as a comma-separated list of issue numbers.' }, { status: 400 });
  }
  if (!verifyRead(token, ids, Number(q.get('exp')), q.get('sig') ?? '')) return new Response(null, { status: 401 });

  const sink = await issues();
  const found = (await Promise.all(ids.map((id) => sink.get(id)))).filter((i) => i !== null);
  const headers = { 'Cache-Control': 'no-store' };
  const file = q.get('file');
  if (file !== null) {
    // Only a path one of these issues lists, so the link cannot reach anything else in the folder.
    if (!found.some((i) => i.attachments.includes(file))) return new Response(null, { status: 404 });
    const type = TYPES[extname(file).toLowerCase()];
    if (!type) return new Response(null, { status: 404 });
    const bytes = await readFile(resolve(process.cwd(), config.issues.dir, file));
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': type } });
  }
  const items = await Promise.all(found.map(async (i) => ({
    ...i, markdown: await readFile(resolve(process.cwd(), i.location), 'utf8').catch(() => null),
  })));
  return Response.json({ items, missing: ids.filter((id) => !found.some((i) => i.id === id)) }, { headers });
});
