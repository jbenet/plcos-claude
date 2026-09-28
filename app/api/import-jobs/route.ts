import { withRoute } from '@/lib/authz/route';
import { getDb } from '@/lib/db';
import { activeImportProgress, importJobSnapshot } from '@/lib/import-jobs/server';
export const dynamic='force-dynamic';
export const GET = withRoute('app/api/import-jobs/route.ts#GET', async function() {
  try {
    const jobs=activeImportProgress()??await importJobSnapshot(await getDb());
    return Response.json({jobs:jobs.map(({id,kind,status,phase,done,total,result,error,created_at,finished_at})=>({id,kind,status,phase,done,total,result,error,created_at,finished_at}))},
      {headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({error:'Import progress is unavailable. Retrying does not restart an import.'},{status:503});}
});
