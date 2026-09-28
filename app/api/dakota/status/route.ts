import { getDb } from '@/lib/db';
import { dakotaLiveServer } from '@/lib/connectors/dakota/job';
import { dakotaStatus } from '@/lib/connectors/dakota/translate';
export const dynamic='force-dynamic';
export async function GET() {
  if(!dakotaLiveServer())return Response.json({job:null},{headers:{'Cache-Control':'no-store'}});
  try {
    const db=await getDb(),job=await dakotaStatus(db);
    return Response.json({job},{headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({error:'Progress is unavailable. Retry shortly; committed batches are preserved.'},{status:503});}
}
