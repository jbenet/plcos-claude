import { withRoute } from '@/lib/authz/route';
import { NextResponse } from 'next/server';
import { consolidatePursuitsAction, reversePursuitMergeAction } from '@/app/dev/enrich/actions';
import { isEntityKey } from '@/lib/enrich/connection-check';

/** Check the caller before parsing input or scheduling either identity mutation. */
export const POST = withRoute('app/api/identity/pursuit-merge/route.ts#POST', async function(request: Request) {
  const input = await request.json().catch(() => null);
  if (input?.operation === 'consolidate') {
    const result = await consolidatePursuitsAction();
    return NextResponse.json(result, { status: result.error ? 409 : 200 });
  }
  if (input?.operation === 'reverse' && isEntityKey(input.mergeId)
    && typeof input.reason === 'string' && input.reason.trim()) {
    const result = await reversePursuitMergeAction(input.mergeId, input.reason);
    return NextResponse.json(result.error ? result : { reversed: true }, { status: result.error ? 409 : 200 });
  }
  return NextResponse.json({ error: 'Supply operation consolidate, or operation reverse with mergeId and reason.' }, { status: 400 });
});
