/** An environment without the Google OAuth client: a preview's, which the launcher starts (scripts/serve.ts). */
export function withoutGoogleOauth(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out.GOOGLE_OAUTH_CLIENT_ID;
  delete out.GOOGLE_OAUTH_CLIENT_SECRET;
  return out;
}
