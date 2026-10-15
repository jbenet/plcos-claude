import { NextResponse } from 'next/server';
import { withRoute } from '@/lib/authz/route';
import { needsScopedProjection } from '@/lib/authz/read/projection';
import { vehicleStrategy } from '@/lib/authz/read/strategy';
import { vehicleSelection } from '@/lib/session';
import { strategyBasis } from '@/lib/strategy-basis';

/**
 * One row's basis on a vehicle's plan, read when the row is opened (lib/strategy-basis.ts). From the same shared
 * build of the plan as the page, so it costs a lookup. Not under /api: the Mac app answers it from its own copy, as
 * it does the page (docs/31). Someone who reads scoped projections never sees this table, so is refused.
 */
export const GET = withRoute('app/[vehicle]/strategy/basis/route.ts#GET', async (request, context: { params: Promise<{ vehicle: string }> }, user) => {
  if (needsScopedProjection(user)) return NextResponse.json({ error: 'Not available.' }, { status: 403 });
  const { vehicle: slug } = await context.params;
  const lp = new URL(request.url).searchParams.get('lp');
  const vehicle = (await vehicleSelection()).all.find(v => v.slug === slug);
  if (!vehicle || !lp) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const row = (await vehicleStrategy(vehicle.id))?.rows.find(r => r.pursuit.pursuitId === lp);
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ basis: strategyBasis(row) }, { headers: { 'cache-control': 'private, no-store' } });
});
