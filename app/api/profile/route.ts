import { withRoute } from '@/lib/authz/route';
import { config } from '@/config/deployment';

/**
 * Which data this server is showing. Asked by anything outside the app that must not touch
 * real data — the screenshot script, first of all — so the answer comes from the server
 * itself rather than from whatever the caller's shell believes.
 */
export const GET = withRoute('app/api/profile/route.ts#GET', function GET() {
  return Response.json({ profile: config.data.profile });
});
