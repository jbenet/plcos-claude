import { config } from '@/config/deployment';

/**
 * Which data this server is showing. Asked by anything outside the app that must not touch
 * real data — the screenshot script, first of all — so the answer comes from the server
 * itself rather than from whatever the caller's shell believes.
 */
export function GET() {
  return Response.json({ profile: config.data.profile });
}
