import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { appendAudit } from '@/modules/platform';
import { VEHICLE_COOKIE } from '@/lib/session';

/**
 * Who am I, and which vehicle am I looking at. Both are local-only presentation state,
 * which is why they may be set optimistically — see the frontend contract.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { userHandle?: string; vehicleSlug?: string };

  if (body.vehicleSlug) {
    const jar = await cookies();
    jar.set(VEHICLE_COOKIE, body.vehicleSlug, { httpOnly: true, sameSite: 'lax', path: '/' });
  }

  if (body.userHandle) {
    const a = await auth();
    if (!a.switchable) {
      return NextResponse.json({ error: 'This deployment does not allow switching users.' }, { status: 400 });
    }
    const before = await a.currentUser();
    const after = await a.switchUser(body.userHandle);
    await appendAudit({
      actorId: before.id,
      action: 'session.user_switched',
      subjectType: 'app_user',
      subjectId: after.id,
      detail: { from: before.handle, to: after.handle },
    });
  }

  return NextResponse.json({ ok: true });
}
