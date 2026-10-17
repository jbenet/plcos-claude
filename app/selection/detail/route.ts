import { NextResponse } from 'next/server';
import { withRoute } from '@/lib/authz/route';
import { scoreDetail } from '@/lib/authz/read/pipeline';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Why one LP on the selection page scores what it does, read when the cursor rests on it (issue 0089). A GET, not a
 * server action (16 Oct 2026): Next runs actions one at a time, so each read queued ahead of a person's Move, and the
 * Mac app sent every action to the live server; as a read it answers from the Mac's own copy, as the page does
 * (docs/31). Not under /api for that reason. Null when the LP is not in that vehicle or the person may not read it.
 */
export const GET = withRoute('app/selection/detail/route.ts#GET', async (request) => {
  const q = new URL(request.url).searchParams;
  const vehicleId = q.get('v'), pursuitId = q.get('lp');
  if (!vehicleId || !pursuitId || !UUID.test(vehicleId) || !UUID.test(pursuitId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ detail: await scoreDetail(vehicleId, pursuitId) }, { headers: { 'cache-control': 'private, no-store' } });
}, (request) => ({ vehicle: new URL(request.url).searchParams.get('v') ?? [] }));
