/** Private W3 export metadata; no addresses or message bodies are exported. */
export interface EmailEvidence {
  massMailing?: boolean;
  loggingType?: string;
  recipientCount?: number;
  oneToOne: boolean;
  bulk: boolean;
  direction?: 'sent' | 'received';
  team?: string[];
}
export type EmailTeamMember = { name: string; email?: string | null; affinityEmail?: string | null; addresses?: string[] };
type Participant = { person?: { id?: number; type?: string; primaryEmailAddress?: string | null; emailAddresses?: string[] }; emailAddress?: string; userId?: number };
export function emailTeamResolver(team: EmailTeamMember[], users: Array<{ id: number; primaryEmailAddress?: string | null; emailAddresses?: string[] }> = []) {
  const addresses = (p: Participant) => [p.emailAddress, p.person?.primaryEmailAddress, ...(p.person?.emailAddresses ?? [])].filter((e): e is string => !!e).map(e => e.trim().toLowerCase());
  // Any of a member's addresses (default-to, login, aliases) or their Affinity address.
  const matches = (emails: string[]) => team.filter(t => [t.email, t.affinityEmail, ...(t.addresses ?? [])].some(e => e && emails.includes(e.trim().toLowerCase())));
  return (p: Participant): string | undefined => {
    const found = new Set(matches(addresses(p)).map(t => t.name));
    // Affinity internal person IDs are user IDs; external IDs are a separate namespace.
    const id = p.userId ?? (p.person?.type === 'internal' ? p.person.id : undefined);
    for (const u of users.filter(u => u.id === id)) for (const t of matches(addresses({ person: u }))) found.add(t.name);
    return found.size === 1 ? [...found][0] : undefined;
  };
}
type Email = { direction?: string; toParticipantsPreview?: { data: Participant[]; totalCount: number }; ccParticipantsPreview?: { data: Participant[]; totalCount: number }; id?: number; type?: string; massMailing?: boolean; loggingType?: string; subject?: string;
  from?: Participant | Participant[]; to?: Participant[]; cc?: Participant[];
  toPreview?: { data: Participant[]; totalCount: number }; ccPreview?: { data: Participant[]; totalCount: number } };

/** Match the translated interaction's stable source ref, including its actual LP participant. */
export function emailEvidenceIndex(payloads: unknown[], team: EmailTeamMember[] = [], users: Array<{ id: number; primaryEmailAddress?: string | null; emailAddresses?: string[] }> = []): (sourceRef: string | null) => EmailEvidence | undefined {
  const who = emailTeamResolver(team, users);
  const emails = new Map<string, Email>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    const e = payload as Email;
    if (e.type === 'email' && e.id != null) emails.set(String(e.id), e);
  }
  return sourceRef => {
    const match = sourceRef?.match(/^interaction:email:([^:]+):person:(\d+)$/);
    const e = match && emails.get(match[1]!);
    if (!e) return undefined;
    const from = Array.isArray(e.from) ? e.from : e.from ? [e.from] : [];
    const toPreview = e.toParticipantsPreview ?? e.toPreview;
    const ccPreview = e.ccParticipantsPreview ?? e.ccPreview;
    const to = e.to ?? toPreview?.data ?? [];
    const cc = e.cc ?? ccPreview?.data ?? [];
    const count = Math.max(to.length, toPreview?.totalCount ?? 0) + Math.max(cc.length, ccPreview?.totalCount ?? 0);
    const isLP = (p: Participant) => String(p.person?.id) === match![2] && p.person?.type !== 'internal' && !who(p);
    const internal = (p: Participant) => !!who(p) || (!team.length && p.person?.type === 'internal');
    // GUESS: strict one-recipient cutoff and newsletter titles err toward weaker ties.
    const bulk = e.massMailing === true || count > 1
      || /mass|bulk|newsletter|mailing.?list|campaign|marketing/i.test(e.loggingType ?? '')
      || /\bnewsletter\b/i.test(e.subject ?? '');
    const inferred = from.length === 1 && to.length === 1
      ? internal(from[0]!) && isLP(to[0]!) ? 'sent'
        : isLP(from[0]!) && internal(to[0]!) ? 'received' : undefined : undefined;
    const declared = e.direction === 'ours' ? 'sent' : e.direction === 'theirs' ? 'received' : e.direction;
    const direction = inferred && (!declared || declared === inferred) ? inferred : undefined;
    return { direction: team.length ? direction : undefined, team: [...new Set([...from, ...to, ...cc].map(who).filter((n): n is string => !!n))], massMailing: e.massMailing, loggingType: e.loggingType, recipientCount: count, bulk,
      oneToOne: (!declared || declared === inferred) && !bulk && count === 1 && to.length === 1 && cc.length === 0 && from.length === 1
        && ((internal(from[0]!) && isLP(to[0]!)) || (isLP(from[0]!) && internal(to[0]!))) };
  };
}
