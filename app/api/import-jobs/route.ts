import { getDb } from '@/lib/db';
import { activeImportProgress, importJobStatus } from '@/lib/import-jobs/server';
export const dynamic='force-dynamic';
export async function GET() {
  try {
    const jobs=activeImportProgress()??await importJobStatus(await getDb());
    return Response.json({jobs:jobs.map(({id,kind,status,phase,done,total,result,error,created_at,finished_at})=>({id,kind,status,phase,done,total,result,error,created_at,finished_at}))},
      {headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({error:'Import progress is unavailable. Retrying does not restart an import.'},{status:503});}
}
