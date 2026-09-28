import { withRoute } from '@/lib/authz/route';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { correctEntityType, reverseEntityTypeCorrection } from '@/modules/identity/entity-type';
import { isEntityKey } from '@/lib/enrich/connection-check';

/** Local identity correction only. Real mutations run in the live server's existing DB handle. */
export const POST = withRoute('app/api/identity/entity-type/route.ts#POST', async function(request: Request, _context, user) {
  if (config.data.profile === 'real' && (config.data.copyTakenAt || !isLiveServer())) {
    return NextResponse.json({ error: 'Correct entity types on the live server.' }, { status: 403 });
  }
  const input = await request.json().catch(() => null);
  if (!input || typeof input.reason !== 'string' || !input.reason.trim()) {
    return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  }
  const reversal = input.operation === 'reverse';
  if (reversal ? !isEntityKey(input.correctionId) :
    input.operation !== 'correct' || !isEntityKey(input.entityId) || !['person', 'org'].includes(input.type) ||
    typeof input.requestKey !== 'string' || !input.requestKey.trim()) {
    return NextResponse.json({ error: 'Supply a correction ID to reverse, or an entity ID, type and stable request key to correct.' }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = reversal
      ? { reversed: await reverseEntityTypeCorrection(db, input.correctionId, user.id, input.reason) }
      : { correctionId: await correctEntityType(db, { entityId: input.entityId, type: input.type, by: user.id,
        reason: input.reason, rule: 'human:entity-type', requestKey: input.requestKey }) };
    revalidatePath('/dev/enrich');
    revalidatePath('/orgs', 'layout');
    revalidatePath('/targets', 'layout');
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Entity type correction failed.' }, { status: 409 });
  }
});
