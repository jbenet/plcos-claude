import { createHash } from 'node:crypto';
import { withRoute } from '@/lib/authz/route';
import { getDb } from '@/lib/db';
import { activeImportProgress, importJobSnapshot } from '@/lib/import-jobs/server';
export const dynamic='force-dynamic';
// The rail polls this every 5 s on every open page; unchanged, it answers 304 with no body (15 Oct 2026: about 80 KB
// of a day's job results, every poll, on the real data).
export const GET = withRoute('app/api/import-jobs/route.ts#GET', async function(request: Request) {
  try {
    const jobs=activeImportProgress()??await importJobSnapshot(await getDb());
    const body=JSON.stringify({jobs:jobs.map(({id,kind,status,phase,done,total,result,error,created_at,finished_at})=>({id,kind,status,phase,done,total,result,error,created_at,finished_at}))});
    const etag=`"${createHash('sha1').update(body).digest('base64url').slice(0,20)}"`;
    const headers={'Cache-Control':'no-store',ETag:etag};
    if(request.headers.get('if-none-match')===etag) return new Response(null,{status:304,headers});
    return new Response(body,{headers:{...headers,'Content-Type':'application/json'}});
  } catch {return Response.json({error:'Import progress is unavailable. Retrying does not restart an import.'},{status:503});}
});
