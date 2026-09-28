import { withRoute } from '@/lib/authz/route';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { USER_COOKIE } from '@/lib/auth/cookie';
import { appendAudit, getUserByHandle } from '@/modules/platform';
import { parseSelections, VEHICLE_COOKIE } from '@/lib/session';
import { MutationGuardError, requireMutationUser } from '@/lib/mutation-guard';

/** Local identity selection is the one bootstrap exception to requiring an existing cookie. */
export const POST = withRoute('app/api/session/route.ts#POST', async function(req: Request) {
  try {
    const body = await req.json() as { userHandle?: string; vehicleSlug?: string };
    const jar = await cookies();
    let who;
    if (body.userHandle) {
      const a = await auth();
      if (!a.switchable) return NextResponse.json({ error: 'This deployment does not allow switching users.' }, { status: 403 });
      if (typeof body.userHandle !== 'string' || !await getUserByHandle(body.userHandle)) {
        return NextResponse.json({ error: 'Select a known active app user.' }, { status: 401 });
      }
      const beforeHandle = jar.get(USER_COOKIE)?.value;
      const before = beforeHandle ? await getUserByHandle(beforeHandle) : null;
      who = await a.switchUser(body.userHandle);
      await appendAudit({ actorId: before?.id ?? who.id, action: 'session.user_switched', subjectType: 'app_user',
        subjectId: who.id, detail: { from: before?.handle ?? null, to: who.handle } });
    } else {
      who = await requireMutationUser();
    }
    if (body.vehicleSlug) {
      if (typeof body.vehicleSlug !== 'string') return NextResponse.json({ error: 'Supply a vehicle slug.' }, { status: 400 });
      const map = parseSelections(jar.get(VEHICLE_COOKIE)?.value, who.handle);
      map[who.handle] = body.vehicleSlug;
      jar.set(VEHICLE_COOKIE, JSON.stringify(map), { httpOnly: true, sameSite: 'lax', path: '/' });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MutationGuardError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Supply a valid session request.' }, { status: 400 });
    throw error;
  }
});
