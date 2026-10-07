/** File-only counterpart of the exported entity-keys map. Never guess between namesakes. */
type IdentityKey = { entityId?: string; candidateKey?: string };
type FindingIdentity = IdentityKey & {
  key: string;
  name?: string;
  identity?: IdentityKey & { match?: string; canonical?: IdentityKey & { name?: string } };
};

export function candidateKey(
  record: { key: string } & IdentityKey,
  candidates: ReadonlyArray<{ key: string; name: string }>,
  aliases: Readonly<Record<string, string>>,
  finding?: FindingIdentity,
): string | null {
  const keys = new Set(candidates.map(c => c.key));
  const resolve = (key: string | undefined) => {
    if (!key) return null;
    if (keys.has(key)) return key;
    const mapped = Object.hasOwn(aliases, key) ? aliases[key] : undefined;
    return mapped && keys.has(mapped) ? mapped : null;
  };
  for (const key of [record.entityId, record.candidateKey, record.key,
    finding?.entityId, finding?.candidateKey, finding?.identity?.entityId,
    finding?.identity?.candidateKey, finding?.identity?.canonical?.entityId,
    finding?.identity?.canonical?.candidateKey, finding?.key]) {
    const resolved = resolve(key);
    if (resolved) return resolved;
  }
  if (!['confirmed', 'probable'].includes(finding?.identity?.match ?? '')) return null;
  const name = finding?.identity?.canonical?.name ?? finding?.name;
  if (!name?.trim()) return null;
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const matches = candidates.filter(c => normalize(c.name) === normalize(name));
  return matches.length === 1 ? matches[0]!.key : null;
}

/**
 * The export's alias map. An alias whose LP is a candidate keeps it. One whose identity is no candidate but speaks for
 * exactly one LP (a contact on its row) files under that LP, and so does the contact's own key (7 Oct 2026: when an LP
 * moved from a person to their organization, 2 Oct, the person's older research keys pointed at the person, who now
 * has no pursuit; 108 organizations' strategies read none of it). A contact of two LPs, or a candidate, never moves.
 */
export function exportAliases(
  aliases: Iterable<[string, string]>,
  candidates: ReadonlyArray<{ key: string; contacts?: ReadonlyArray<{ key: string }> }>,
): Array<[string, string]> {
  const keys = new Set(candidates.map(c => c.key));
  const speaksFor = new Map<string, Set<string>>();
  for (const c of candidates) for (const contact of c.contacts ?? []) speaksFor.set(contact.key, (speaksFor.get(contact.key) ?? new Set()).add(c.key));
  const lpOf = (key: string) => {
    if (keys.has(key)) return key;
    const lps = speaksFor.get(key);
    return lps?.size === 1 ? [...lps][0]! : null;
  };
  const out = new Map<string, string>();
  for (const [from, key] of aliases) {
    const lp = lpOf(key);
    if (lp && (lp === key || !keys.has(from))) out.set(from, lp);
  }
  for (const contact of speaksFor.keys()) {
    const lp = lpOf(contact);
    if (lp && lp !== contact && !out.has(contact)) out.set(contact, lp);
  }
  return [...out];
}
