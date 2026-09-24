import type { Direction, Read } from '@/modules/meetings/client';
import type { OutcomeReason, PassedBy, PursuitStatus } from './types';

/**
 * Reading an update (N61, issue 0004). Juan, 24 Sep: "we should LLM process the output to
 * decide on what to do with the update (ie change status, etc)". A model's reading waits for
 * the agent runtime (L13): the Agent seam refuses until a run is enveloped, pinned and checked
 * against example cases. Until then these word rules read it, and the page says so. Each
 * suggestion carries the words it rests on, so a wrong one shows why it is wrong, and nothing
 * is applied until a person saves with it ticked.
 *
 * It may suggest a status, the touchpoint the update describes (a meeting, a call, an email),
 * their read after it, and a next step. It never suggests a rung: the ladder moves on a STAGE
 * ticket, and reconciliation proposes one from the touchpoint once it is logged. It never
 * records an amount either; it points to the close track instead (rule 1). Pure: it runs in
 * the browser as someone types and again on the server, which keeps what it said.
 */
export const READER = { name: 'rules', version: 1 } as const;

export type TouchChannel = 'meeting' | 'call' | 'email' | 'message';

export type UpdateSuggestion =
  | { kind: 'status'; to: PursuitStatus; passedBy?: PassedBy; reason?: OutcomeReason; basis: string }
  | {
      kind: 'touch'; channel: TouchChannel; direction: Direction; on: string; ahead: boolean;
      /** False when no date was written: it says today, and the form asks. */
      dated: boolean; basis: string;
    }
  | { kind: 'read'; read: Read; basis: string }
  | { kind: 'next'; step: string; on: string | null; basis: string }
  | { kind: 'amount'; said: string; basis: string };

/** Forward order; Passed is off to the side, and any status can reopen from it. */
const ORDER: PursuitStatus[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed'];

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NEGATED = /\b(?:not|never|no|haven'?t|hasn'?t|hadn'?t|didn'?t|don'?t|doesn'?t|won'?t|isn'?t|aren'?t|wasn'?t|weren'?t|without)\s+(?:yet\s+|really\s+|actually\s+|been\s+|even\s+)?$/i;

/** The first match that isn't negated just before it: "haven't met" is not a meeting. */
function find(re: RegExp, text: string): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (NEGATED.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    return m;
  }
  return null;
}

/** The sentence or clause around a match, so a date is read beside what it dates. */
function clauseAt(text: string, index: number): { start: number; end: number } {
  const start = Math.max(...['.', ';', '\n'].map((c) => text.lastIndexOf(c, index))) + 1;
  const ends = ['.', ';', '\n'].map((c) => text.indexOf(c, index)).filter((i) => i >= 0);
  return { start, end: ends.length ? Math.min(...ends) : text.length };
}

const quote = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
};

/** The date the words put something on: today, yesterday, a weekday, "22 Sep", "in 2 weeks". */
export function dateIn(text: string, today: string, ahead: boolean): { on: string; basis: string } | null {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(t0)) return null;
  let m: RegExpExecArray | null;
  if ((m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(text))) return { on: `${m[1]}-${m[2]}-${m[3]}`, basis: m[0] };
  if ((m = /\b(today|this (?:morning|afternoon|evening)|tonight)\b/i.exec(text))) return { on: today, basis: m[0] };
  if ((m = /\b(yesterday|last night)\b/i.exec(text))) return { on: iso(t0 - DAY), basis: m[0] };
  if ((m = /\btomorrow\b/i.exec(text))) return { on: iso(t0 + DAY), basis: m[0] };
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(20\d\d))?\b/i.exec(text)
    ?? null;
  const md = dm ? null : /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/i.exec(text);
  if (dm || md) {
    const day = Number(dm ? dm[1] : md![2]);
    const month = MONTHS.indexOf((dm ? dm[2] : md![1])!.toLowerCase().slice(0, 3));
    const year = dm?.[3] ?? md?.[3];
    if (day >= 1 && day <= 31 && month >= 0) {
      let y = year ? Number(year) : new Date(t0).getUTCFullYear();
      let t = Date.UTC(y, month, day);
      // No year written: a past event is this side of today, a plan the far side.
      if (!year && !ahead && t > t0 + 2 * DAY) t = Date.UTC(--y, month, day);
      if (!year && ahead && t < t0) t = Date.UTC(++y, month, day);
      return { on: iso(t), basis: (dm ?? md)![0] };
    }
  }
  if ((m = /\b(?:(last|next|this|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text))) {
    const want = WEEKDAYS.indexOf(m[2]!.toLowerCase());
    const dow = new Date(t0).getUTCDay();
    const which = m[1]?.toLowerCase();
    const future = which === 'next' ? true : which === 'last' ? false : ahead;
    let delta = future ? (want - dow + 7) % 7 || 7 : -((dow - want + 7) % 7);
    if (which === 'last' && delta === 0) delta = -7;
    return { on: iso(t0 + delta * DAY), basis: m[0] };
  }
  if ((m = /\bin\s+(a|an|one|two|three|four|\d+)\s+(day|week|month)s?\b/i.exec(text))) {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 }[m[1]!.toLowerCase()] ?? Number(m[1]);
    const unit = { day: 1, week: 7, month: 30 }[m[2]!.toLowerCase() as 'day' | 'week' | 'month'];
    return { on: iso(t0 + n * unit * DAY), basis: m[0] };
  }
  if ((m = /\b(\d+|a|one|two|three)\s+(day|week)s?\s+ago\b/i.exec(text))) {
    const n = { a: 1, one: 1, two: 2, three: 3 }[m[1]!.toLowerCase()] ?? Number(m[1]);
    return { on: iso(t0 - n * (m[2]!.toLowerCase() === 'week' ? 7 : 1) * DAY), basis: m[0] };
  }
  if ((m = /\bnext week\b/i.exec(text))) return { on: iso(t0 + 7 * DAY), basis: m[0] };
  return null;
}

// What the words say happened, or will. Each is read against its negation first.
const PASS = /\b(?:passed|passing|pass(?:es)? on (?:this|it|the fund|us)|declin(?:ed|es|ing)|turned (?:us|it|this) down|not (?:investing|going to invest|a fit|moving forward|participating|interested)|won'?t (?:invest|be investing|participate|commit)|(?:decided|chose) (?:against|not to)|no longer interested|out for this (?:one|fund|round))\b/i;
const PASS_US = /\b(?:we|i)(?:'re| are| have|'ve| had)?\s+(?:(?:decided|chose)\s+(?:to\s+)?)?(?:pass(?:ed|ing)?|stop(?:ped|ping)?|drop(?:ped|ping)?|deprioriti[sz](?:ed|ing)?|not (?:pursuing|going to pursue))\b/i;
const DO_NOT_CONTACT = /\b(?:(?:do not|don'?t|stop) (?:contact|approach|reach out to|email)(?:ing)?|do[- ]not[- ]contact)\b/i;
const COMMITTED = /\b(?:committed|verbal(?:ly)? (?:commit(?:ted)?|yes)|soft[- ]?circled?|said yes|(?:will|going to|plans? to|wants? to) invest\b(?! in (?!(?:us|the fund|this|it)\b))|(?:they'?re|they are|he'?s|she'?s|he is|she is) in(?=[.!,;]|\s*$|\s+for\b)|in for \$?\d)/i;
const MET = /\b(?:met(?: with)?|had (?:a|an|our|the) (?:first |second |third |follow-?up |intro |quick )?(?:meeting|call|chat|coffee|lunch|dinner|zoom)|spoke (?:with|to)|talked (?:with|to)|caught up|(?:call|meeting|zoom|coffee|lunch|dinner)(?: with (?:them|him|her|[a-z]+))? (?:went|today|yesterday|this (?:morning|afternoon)|last (?:week|night))|saw (?:them|him|her))\b/i;
const PLANNED = /\b(?:(?:scheduled|booked|set up|setting up|arranged|arranging|lined up|confirmed) (?:a |an |the |our )?(?:first |second |follow-?up |intro )?(?:meeting|call|chat|coffee|lunch|dinner|zoom)|(?:meeting|call|zoom|coffee|lunch|dinner) (?:is |was )?(?:set|booked|scheduled|planned|confirmed) for|(?:meeting|call|zoom|coffee|lunch|dinner)(?: with (?:them|him|her|[a-z]+))? (?:next|tomorrow|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))|will meet|(?:meeting|meet) (?:them|him|her) (?:next|on|tomorrow))\b/i;
// Read before REACHED, so "they emailed" is theirs and "emailed Anneliese" is ours.
const REPLIED = /\b(?:(?:they|she|he) (?:replied|responded|wrote(?: back)?|got back(?: to (?:us|me))?|answered|emailed|messaged|texted)|heard back|reply from|response from)\b/i;
const REACHED = /\b(?:reached out|e-?mailed|wrote to|sent (?:them |him |her )?(?:an? )?(?:email|note|message|linkedin message|dm|intro email)|messaged|pinged|followed up|following up|left (?:a )?(?:message|voicemail)|texted)\b/i;
const INTRO_ASK = /\b(?:asked (?:\w+ ){0,4}(?:for an? intro|to intro(?:duce)?|to connect us)|intro (?:request|ask)|(?:happy|willing|offered|agreed) to (?:intro(?:duce)?|connect us|make the intro)|will intro(?:duce)?|(?:finding|looking for) (?:a )?(?:connector|warm intro|way in))\b/i;
const SELECT = /\b(?:should (?:reach out|contact|approach|talk to|meet)|let'?s (?:reach out|contact|approach)|(?:add(?:ed)?|put) (?:them |him |her )?(?:on|to) (?:the )?(?:target|outreach|priority) list|prioriti[sz]e(?:d)?|(?:good|strong|great) (?:fit|target))\b/i;
const SOURCE = /\b(?:research(?:ing)? (?:them|him|her)|look(?:ing)? into|dig(?:ging)? into|enrich|find out (?:more|who))\b/i;

const VERY = /\b(?:(?:very|super|really|extremely) (?:interested|keen|excited|positive|enthusiastic)|loved (?:it|the)|enthusiastic|excited)\b/i;
const NOT_VERY = /\b(?:lukewarm|luke-warm|not (?:very|that|so|super|too|particularly) (?:interested|keen|excited)|skeptical|sceptical|hesitant|cool (?:on|to)|unconvinced|not convinced|on the fence)\b/i;
const INTERESTED = /\b(?:interested|keen|positive|warm|receptive|curious|liked (?:it|the))\b/i;

const WANTS = /\b(?:want(?:s|ed)?|asked for|requested|need(?:s|ed)?|would like|waiting (?:on|for)) (?:to see )?(?:the |a |our |more )?(deck|memo|data ?room|model|docs|materials|ppm|lpa|sub(?:scription)? docs|one-?pager|track record|references|financials|term sheet)\b/i;
const NEXT = /\bnext(?: steps?)?\s*[:\-–—]\s*([^.\n;]+)/i;
const FOLLOW = /\b(?:follow(?:ing)? up|check in|circle back|reconnect|revisit)\b/i;
const BY = /\b(?:by|before|on|in|next)\s+(?:(?:the\s+)?(?:\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}|[a-z]{3,9}\s+\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|week|(?:a|an|one|two|three|four|\d+)\s+(?:day|week|month)s?))\b/i;
const MONEY = [/\$\s?\d[\d.,]*\s?(?:mm|m|k|million|thousand|bn|b)?\b/i, /\b\d[\d.,]*\s?(?:M|MM|K)\b/, /\b\d[\d.,]*\s?million\b/i];

const REASON_WORDS: Array<[OutcomeReason, RegExp]> = [
  ['do_not_contact', DO_NOT_CONTACT],
  ['timing', /\b(?:timing|too early|too late|not (?:right )?now|next (?:year|fund|quarter)|later this year|revisit|circle back|in (?:q[1-4]|the new year))\b/i],
  ['valuation', /\b(?:valuation|pric(?:e|ing)|too expensive)\b/i],
  ['structure', /\b(?:structure|fees|carry|lock-?up|minimum)\b/i],
  ['concentration', /\b(?:concentration|over-?allocated|already (?:have|hold|in)|too much exposure)\b/i],
  ['mandate', /\b(?:mandate|not (?:our|their) (?:space|focus|area|remit)|outside (?:their|our) (?:focus|mandate|scope))\b/i],
  ['thesis', /\b(?:thesis|don'?t believe in|not convinced by the (?:space|market))\b/i],
  ['diligence', /\b(?:after|in|during|failed) (?:diligence|dd)\b/i],
];

function channelOf(words: string): TouchChannel {
  if (/\b(?:call|phone|rang)\b/i.test(words)) return 'call';
  if (/\b(?:e-?mail(?:ed|s)?|wrote|note|replied|responded|wrote back|got back|answered|heard back|reply|response)\b/i.test(words)) return 'email';
  if (/\b(?:messaged|pinged|texted|dm|linkedin|message|voicemail)\b/i.test(words)) return 'message';
  return 'meeting';
}

export function readUpdate(text: string, ctx: { status: PursuitStatus; today: string }): UpdateSuggestion[] {
  const out: UpdateSuggestion[] = [];
  const body = text.trim();
  if (!body) return out;
  const ahead = (to: PursuitStatus) => ctx.status === 'passed' || ORDER.indexOf(to) > ORDER.indexOf(ctx.status);

  // The touchpoint it describes, if any: a meeting held, a reply, a meeting set, our outreach.
  const met = find(MET, body);
  const replied = met ? null : find(REPLIED, body);
  const planned = met || replied ? null : find(PLANNED, body);
  const reached = met || replied || planned ? null : find(REACHED, body);
  const touchHit = met ?? replied ?? planned ?? reached;
  if (touchHit) {
    const future = touchHit === planned;
    const c = clauseAt(body, touchHit.index);
    const found = dateIn(body.slice(c.start, c.end), ctx.today, future);
    // A past meeting dated ahead of today is a misreading: say today, and let the form ask.
    const when = found && !future && found.on > ctx.today ? null : found;
    // A meeting being set needs its date to be logged; without one, the status says it.
    if (!(future && !when)) {
      out.push({
        kind: 'touch', channel: channelOf(touchHit[0]),
        direction: touchHit === reached ? 'ours' : touchHit === replied ? 'theirs' : 'both',
        on: when?.on ?? ctx.today, ahead: future && Boolean(when && when.on > ctx.today), dated: Boolean(when),
        basis: quote(when && !touchHit[0].toLowerCase().includes(when.basis.toLowerCase()) ? `${touchHit[0]} … ${when.basis}` : touchHit[0]),
      });
    }
  }

  // The status, strongest first: an ending, a yes, engagement, outreach, a decision to approach.
  const pass = find(PASS, body) ?? find(DO_NOT_CONTACT, body);
  const yes = pass ? null : find(COMMITTED, body);
  if (pass && ctx.status !== 'passed') {
    const us = find(PASS_US, body);
    const reason = REASON_WORDS.find(([, re]) => find(re, body))?.[0] ?? 'other';
    out.push({ kind: 'status', to: 'passed', passedBy: us && !find(DO_NOT_CONTACT, body) ? 'us' : 'them', reason, basis: quote((us ?? pass)[0]) });
  } else if (yes && ahead('committed')) {
    out.push({ kind: 'status', to: 'committed', basis: quote(yes[0]) });
  } else if (!pass && !yes) {
    const engaged = met ?? replied ?? planned;
    const outreach = reached ?? find(INTRO_ASK, body);
    const select = find(SELECT, body);
    const source = find(SOURCE, body);
    if (engaged && ahead('discussing')) out.push({ kind: 'status', to: 'discussing', basis: quote(engaged[0]) });
    else if (!engaged && outreach && ahead('connecting')) out.push({ kind: 'status', to: 'connecting', basis: quote(outreach[0]) });
    else if (!engaged && !outreach && select && ahead('selected')) out.push({ kind: 'status', to: 'selected', basis: quote(select[0]) });
    else if (!engaged && !outreach && !select && source && ctx.status === 'new') out.push({ kind: 'status', to: 'sourcing', basis: quote(source[0]) });
  }

  // Their read, only beside a touchpoint that happened: it is recorded on one (docs/17 §4).
  const held = out.find((s): s is Extract<UpdateSuggestion, { kind: 'touch' }> => s.kind === 'touch' && !s.ahead && s.direction !== 'ours');
  if (held) {
    const very = find(VERY, body);
    const cool = very ? null : find(NOT_VERY, body);
    const warm = very || cool ? null : find(INTERESTED, body);
    const r = very ? ['very_interested', very] as const : cool ? ['not_very_interested', cool] as const : warm ? ['interested', warm] as const : null;
    if (r) out.push({ kind: 'read', read: r[0], basis: quote(r[1][0]) });
  }

  // A next step: written as one, materials they asked for, or a follow-up.
  const next = NEXT.exec(body);
  const wants = next ? null : find(WANTS, body);
  const follow = next || wants ? null : find(FOLLOW, body);
  const stepHit = next ?? wants ?? follow;
  if (stepHit) {
    const step = next ? next[1]!.trim().replace(/^./, (c) => c.toUpperCase())
      : wants ? `Send the ${wants[1]!.toLowerCase().replace(/^data ?room$/, 'data room')}`
      : 'Follow up';
    const by = BY.exec(body.slice(stepHit.index, clauseAt(body, stepHit.index).end));
    const when = by ? dateIn(by[0], ctx.today, true) : null;
    // The date goes in the date field, not the step's words.
    const words = when && by ? step.replace(new RegExp(`\\s*${by[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '') : step;
    out.push({ kind: 'next', step: words.slice(0, 140), on: when?.on ?? null, basis: quote(when && !stepHit[0].includes(when.basis) ? `${stepHit[0]} … ${when.basis}` : stepHit[0]) });
  }

  // An amount is never recorded from an update: said where, and pointed at the close track.
  for (const re of MONEY) {
    const m = re.exec(body);
    if (m) { out.push({ kind: 'amount', said: m[0].trim(), basis: quote(m[0]) }); break; }
  }
  return out;
}
