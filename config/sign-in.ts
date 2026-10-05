/**
 * Which sign-in a server uses, from its environment alone (docs/deploy/railway.md §3). Its own module,
 * importing nothing, so config/ports.ts and config/deployment.ts can both ask without importing each
 * other.
 *
 *   labos   LABOS_ME_URL is set: PL's LabOS kit (rev 3).
 *   google  a deployed server: the image says so (PLCOS_DEPLOYED=1, set in the Dockerfile), or Railway
 *           does (RAILWAY_ENVIRONMENT_ID / RAILWAY_PROJECT_ID). Until the Google client is entered in
 *           /setup nobody can sign in; it never falls back to the user switcher.
 *   local   everything else: the Mac's live server, its demos and previews, a sub-agent's worktree.
 *
 * The Mac never sets PLCOS_DEPLOYED, so its servers keep the local switcher. A screenshot run of /setup
 * on a demo sets it on purpose.
 */
export type SignInKind = 'local' | 'labos' | 'google';
type Env = Record<string, string | undefined>;

/** A server built from the image or running on Railway. A typo fails loudly rather than reading as "no". */
export function deployedServer(env: Env = process.env): boolean {
  const flag = env.PLCOS_DEPLOYED?.trim();
  if (flag && flag !== '1') throw new Error(`PLCOS_DEPLOYED must be 1 or unset, not "${flag}".`);
  return flag === '1' || !!env.RAILWAY_ENVIRONMENT_ID?.trim() || !!env.RAILWAY_PROJECT_ID?.trim();
}

export function signInKind(env: Env = process.env): SignInKind {
  if (env.LABOS_ME_URL) return 'labos';
  return deployedServer(env) ? 'google' : 'local';
}

/** A deployed sign-in provider is on (LabOS or Google): this process is the live server for its data. */
export const signInProviderOn = (env: Env = process.env): boolean => signInKind(env) !== 'local';
