import { NextResponse } from 'next/server';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { auth } from '@/lib/auth';
import { getEntity } from '@/modules/identity';
import { feedbackInput, saveConnectionFeedback } from '@/lib/enrich/feedback';

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ error: 'Use the feedback box on this server.' }, { status: 403 });
  let input;
  try { input = feedbackInput(await req.json()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid feedback.' }, { status: 400 }); }
  const provider = await auth();
  const user = await provider.currentUser();
  if (!(await provider.listUsers()).some((u) => u.id === user.id)) return NextResponse.json({ error: 'Choose an active team member.' }, { status: 403 });
  if (!await getEntity(input.lp)) return NextResponse.json({ error: 'This LP is no longer available.' }, { status: 404 });
  try {
    const receipt = await saveConnectionFeedback(join(process.cwd(), config.data.root, 'enrich'), {
      ...input, author: { id: user.id, handle: user.handle, name: user.name }, at: new Date().toISOString(),
    });
    return NextResponse.json({ id: receipt.id, at: receipt.at });
  } catch {
    return NextResponse.json({ error: 'No save receipt was received. Keep this note and retry; retries do not duplicate it.' }, { status: 500 });
  }
}
