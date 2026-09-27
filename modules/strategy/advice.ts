/**
 * Issue 0097: a recommendation beside the pipeline counts and beside the gaps, computed from the
 * records rather than written once. Pure: the page gathers the facts, this chooses the words, and
 * the properties check the choices on invented numbers. Every sentence says what to do with which
 * LPs; none claims a conversion rate the records do not hold.
 */
export type Seg = string | { text: string; href: string };
export type Sentence = Seg[];
const n = (x: number) => x.toLocaleString('en-US');
const list = (items: Seg[]): Seg[] => items.flatMap((item, i) => [i === 0 ? '' : i === items.length - 1 ? ' and ' : ', ', item]).filter(s => s !== '');

export interface PipelineFacts {
  counts: { new: number; sourcing: number; selected: number; connecting: number; discussing: number; committed: number };
  /** Soft indications held by LPs at Committed: the nearest capital, still not hard. */
  softCommitted: { lps: number; amount: number };
  /** Hard-only gap to target; null when no target is recorded. */
  gap: number | null;
  /** Mean soft indication, used as a GUESS check size; null without indications. */
  meanSoft: number | null;
  /** Discussing LPs worth a follow-up first (largest supported capacity), at most three. */
  discussingKey: Array<{ text: string; href: string }>;
  connectingWithRoute: number;
  /** GUESS: introductions one team can ask for in a week. */
  introBatch: number;
  links: { discussing: string; connecting: string; selection: string };
  money: (x: number) => string;
}

export function pipelineAdvice(f: PipelineFacts): Sentence[] {
  const c = f.counts;
  const open = c.new + c.sourcing + c.selected + c.connecting + c.discussing + c.committed;
  if (!open) return [['Nothing is in play yet. Start in ', { text: 'Selection', href: f.links.selection }, ': pick who to approach first, then move them to Selected.']];
  const out: Sentence[] = [];

  // Nearest money: soft to harden, then the conversations that could commit.
  const close: Sentence[] = [];
  if (f.softCommitted.lps) close.push([`harden the ${f.money(f.softCommitted.amount)} soft held by ${n(f.softCommitted.lps)} Committed LP${f.softCommitted.lps === 1 ? '' : 's'}`]);
  if (c.discussing) close.push([
    'follow up with the ', { text: `${n(c.discussing)} in Discussing`, href: f.links.discussing }, ' to get them to commit',
    ...(f.discussingKey.length ? [', starting with ', ...list(f.discussingKey)] : []),
  ]);
  if (close.length) out.push(['Close what is nearest: ', ...close.flatMap((s, i) => i ? [', and ', ...s] : s), '.']);

  // Widen: replies and introductions for Connecting, then refill Selected from Sourcing.
  const widen: Sentence[] = [];
  if (c.connecting) {
    const batch = Math.min(f.introBatch, f.connectingWithRoute);
    widen.push(batch
      ? ['get introductions or replies for ', { text: `${n(batch)} of the ${n(c.connecting)} in Connecting`, href: f.links.connecting },
        f.connectingWithRoute > batch ? ` this week (${n(f.connectingWithRoute)} have a recorded route)` : ' with a recorded route']
      : ['find routes into the ', { text: `${n(c.connecting)} in Connecting`, href: f.links.connecting }, '; none has a recorded route']);
  }
  const thinSelected = c.selected < Math.max(5, Math.round(c.connecting / 10)) && c.sourcing + c.new > 0;
  if (thinSelected) widen.push(['move the best of ', { text: `${n(c.sourcing + c.new)} in New and Sourcing`, href: f.links.selection }, ` into Selected (${n(c.selected)} there now)`]);
  if (widen.length) out.push([out.length ? 'Then widen: ' : 'Widen: ', ...widen.flatMap((s, i) => i === 0 ? s : [', and ', ...s]), '.']);
  // How far the pipeline past Selected is from the gap, at the mean indication as a GUESS check size.
  if (f.gap !== null && f.gap > 0 && f.meanSoft && out.length < 2) {
    const needed = Math.ceil(f.gap / f.meanSoft);
    const inPlay = c.selected + c.connecting + c.discussing;
    out.push([`At the ${f.money(f.meanSoft)} mean indication (GUESS), the ${f.money(f.gap)} gap needs about ${n(needed)} more commitment${needed === 1 ? '' : 's'}`,
      needed > inPlay ? [`, more than the ${n(inPlay)} LPs from Selected to Discussing: widen from `, { text: 'Selection', href: f.links.selection }, '.']
        : `; ${n(inPlay)} LPs from Selected to Discussing is enough only if most of them commit.`].flat());
  }
  if (!out.length) out.push(['Everyone in play is early. Move the strongest of Sourcing into Selected and look for routes.']);
  return out.map(s => capitalise(s));
}

export interface GapFacts {
  active: number;
  /** Active LPs from Selected to Committed: the ones a gap stops soonest. */
  near: number;
  gaps: Array<{ id: GapId; total: number; near: number; href: string }>;
}
export type GapId = 'research' | 'strategy' | 'route' | 'unsearched' | 'refresh-route' | 'owner';
/** What to do about each gap, in order of how much it blocks: no research means no score at all. */
const FIX: Record<GapId, { verb: string; tail: string }> = {
  research: { verb: 'research', tail: ' with nothing on file' },
  owner: { verb: 'give an active owner to', tail: '' },
  unsearched: { verb: 'run a route search for', tail: '' },
  route: { verb: 'look for another way into', tail: ' whose last route search found none' },
  strategy: { verb: 'write a vehicle strategy for', tail: '' },
  'refresh-route': { verb: 'refresh the route search for', tail: '' },
};
const ORDER = Object.keys(FIX) as GapId[];

export function gapAdvice(f: GapFacts): Sentence[] {
  if (!f.active) return [['No active LPs, so no gaps to close yet.']];
  const near = f.gaps.filter(g => g.near > 0).sort((a, b) => b.near - a.near || ORDER.indexOf(a.id) - ORDER.indexOf(b.id)).slice(0, 2);
  const out: Sentence[] = [];
  if (near.length) {
    const [first, second] = near;
    out.push([
      'Nearest money first: ', FIX[first!.id].verb, ' ',
      { text: `the ${n(first!.near)} LP${first!.near === 1 ? '' : 's'} from Selected to Committed`, href: first!.href }, FIX[first!.id].tail,
      ...(second ? [', and ', FIX[second.id].verb, ' ', { text: n(second.near), href: second.href }, FIX[second.id].tail] : []), '.',
    ]);
  }
  const far = f.gaps.filter(g => g.total - g.near > f.active / 2).sort((a, b) => b.total - a.total)[0];
  if (far) out.push([
    `The ${n(far.total)} ${far.id === 'research' ? 'without research' : far.id === 'strategy' ? 'without a strategy' : far.id === 'owner' ? 'without an active owner' : 'without a usable route'} sit mostly in New and Sourcing: `,
    'let the Selection ranking choose who is worth that work, rather than a bulk push.',
  ]);
  if (!out.length) {
    const small = f.gaps.every(g => g.total <= Math.max(1, f.active * 0.05));
    out.push([small ? 'Coverage is fine: every gap is under 5% of active LPs and none touches an LP from Selected on. Keep working the pipeline.'
      : 'Nothing blocks the LPs from Selected on. The remaining gaps are in New and Sourcing, where the Selection ranking decides who is worth the work.']);
  }
  return out;
}

function capitalise(s: Sentence): Sentence {
  const [head, ...rest] = s;
  if (typeof head === 'string' && head) return [head.charAt(0).toUpperCase() + head.slice(1), ...rest];
  if (head && typeof head === 'object') return [{ ...head, text: head.text.charAt(0).toUpperCase() + head.text.slice(1) }, ...rest];
  return s;
}
