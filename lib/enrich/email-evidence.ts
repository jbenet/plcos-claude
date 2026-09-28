/** Private W3 export metadata; no addresses or message bodies are exported. */
export interface EmailEvidence {
  massMailing?: boolean;
  loggingType?: string;
  recipientCount?: number;
  oneToOne: boolean;
  bulk: boolean;
}
type Participant = { person?: { id?: number; type?: string }; emailAddress?: string };
type Email = { id?: number; type?: string; massMailing?: boolean; loggingType?: string; subject?: string;
  from?: Participant | Participant[]; to?: Participant[]; cc?: Participant[];
  toPreview?: { data: Participant[]; totalCount: number }; ccPreview?: { data: Participant[]; totalCount: number } };

/** Match the translated interaction's stable source ref, including its actual LP participant. */
export function emailEvidenceIndex(payloads: unknown[]): (sourceRef: string | null) => EmailEvidence | undefined {
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
    const to = e.to ?? e.toPreview?.data ?? [];
    const cc = e.cc ?? e.ccPreview?.data ?? [];
    const count = Math.max(to.length, e.toPreview?.totalCount ?? 0) + Math.max(cc.length, e.ccPreview?.totalCount ?? 0);
    const isLP = (p: Participant) => String(p.person?.id) === match![2] && p.person?.type === 'external';
    const internal = (p: Participant) => p.person?.type === 'internal';
    // GUESS: strict one-recipient cutoff and newsletter titles err toward weaker ties.
    const bulk = e.massMailing === true || count > 1
      || /mass|bulk|newsletter|mailing.?list|campaign|marketing/i.test(e.loggingType ?? '')
      || /\bnewsletter\b/i.test(e.subject ?? '');
    return { massMailing: e.massMailing, loggingType: e.loggingType, recipientCount: count, bulk,
      oneToOne: !bulk && count === 1 && to.length === 1 && cc.length === 0 && from.length === 1
        && ((internal(from[0]!) && isLP(to[0]!)) || (isLP(from[0]!) && internal(to[0]!))) };
  };
}
