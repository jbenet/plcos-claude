'use server';
import { requireAction } from '@/lib/authz/server';

import { queueImportJob } from '@/lib/import-jobs/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { decideMove, type MoveRow } from '@/modules/strategy/moves';

export async function saveMove(input: {id:string;vehicleId:string;version:number;state:MoveRow['state'];position:number|null;note:string}): Promise<{error?:string}> {
  const authorizedUser = await requireAction('app/[vehicle]/strategy/actions.ts#saveMove', input);
  try {
    const user = authorizedUser;
    await decideMove(await getDb(),user.id,input);
    revalidatePath('/[vehicle]/strategy','page'); return {};
  } catch(e) { return {error:e instanceof Error ? e.message : 'Could not save. Retry after reloading.'}; }
}
export async function importMoveFile(): Promise<{error?:string;message?:string}> {
  const authorizedUser = await requireAction('app/[vehicle]/strategy/actions.ts#importMoveFile');
  if (config.data.profile === 'real' && !config.data.copyTakenAt && !isLiveServer()) return {error:'Import on the live server or a marked preview copy.'};
  try {
    const actor=(authorizedUser).id, db=await getDb();
    await queueImportJob(db,'strategy-moves',actor);return {message:'Strategy moves queued. Progress appears above.'};
  } catch(e) {
    // The validator's own fixed messages say which check refused; anything else stays generic.
    const why=e instanceof Error && /^(Invalid|Missing|Duplicate|Unknown|Removing|Estimate)/.test(e.message) ? ` ${e.message}` : '';
    return {error:`Import refused.${why} Check menu.json, provenance, GUESS inputs and vehicle scopes; no partial import was applied.`};
  }
}
