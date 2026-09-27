/** DB-free liveness: even a busy database must not prevent the server from answering. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ ok: true });
}
