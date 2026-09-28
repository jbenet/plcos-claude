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
