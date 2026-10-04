/** An environment without the mailguard key or address: a preview's, which the launcher starts (scripts/serve.ts). */
export function withoutMailguard(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out.MAILGUARD_TOKEN;
  delete out.MAILGUARD_URL;
  return out;
}
