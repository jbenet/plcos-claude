/**
 * Everything this tool may ask Affinity (docs/15). A request for any other path is refused
 * before it leaves the machine, and so is any method but GET — there is no write in this
 * client to refuse, and the guard in `fetch.ts` makes sure none can be added quietly.
 *
 * The paths are from Affinity's own OpenAPI description (v2, 2026-07-15), not from memory.
 * Adding one is a reviewed change: it appears in a diff, and on Developer → Affinity.
 */
export interface Endpoint {
  template: string;
  purpose: string;
  /** Affinity marks it BETA: it may change without notice or versioning. */
  beta?: boolean;
}

export const ALLOWED: readonly Endpoint[] = [
  { template: '/v2/auth/whoami', purpose: 'Whose key this is, which account, and what the key may do.' },
  { template: '/v2/rate-limit', purpose: 'How much of the per-minute and monthly budget is left.', beta: true },
  { template: '/v2/lists', purpose: 'Every list the key can see: name, type, owner and privacy.' },
  { template: '/v2/lists/{listId}', purpose: 'One list’s metadata.' },
  { template: '/v2/lists/{listId}/fields', purpose: 'The fields on a list, to find which is stage, owner and amount.' },
  {
    template: '/v2/lists/{listId}/fields/{fieldId}/dropdown-options',
    purpose: 'The values a dropdown field can take, so a stage can be read as a stage.',
  },
  { template: '/v2/lists/{listId}/saved-views', purpose: 'The views people have saved on a list.' },
  { template: '/v2/users', purpose: 'The account’s users, to match owners and note authors to our team.', beta: true },
];

/**
 * What may stand in each id position. Affinity's ids are integers, except a field's, which
 * is a slug like `field-1234` or `affinity-data-location` (OpenAPI, 2026-07-15). Anything
 * else — a slash, a dot, a percent sign — is not a path we asked for.
 */
const ID: Record<string, string> = { fieldId: '[a-z][a-z0-9-]*' };

const compiled = ALLOWED.map((e) => ({
  endpoint: e,
  re: new RegExp(`^${e.template.replace(/\{([a-zA-Z]+)\}/g, (_m, name: string) => ID[name] ?? '\\d+')}$`),
}));

/** The allowlisted endpoint a path matches, or null. The path is without its query. */
export function allowed(path: string): Endpoint | null {
  return compiled.find((c) => c.re.test(path))?.endpoint ?? null;
}
