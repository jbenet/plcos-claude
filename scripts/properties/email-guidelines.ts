/**
 * The email guidelines (docs/email-guidelines.md) and the prefill that follows them, on invented
 * people only (Juan, 3 Oct 2026: "This is not a good email").
 *   - the prefill never carries the strategy's analysis: no citations, reading dates, notes to
 *     ourselves, third person about the recipient, template lines or amounts — whatever the strategy holds;
 *   - one vehicle per draft;
 *   - the intro-ask kind goes to the connector, greets them, and carries the forwardable note;
 *   - the checker validates the optional `firstMessage` field; the guideline's own examples pass, the bad one fails;
 *   - the voice in Preferences is each person's own, and its audit keeps no words.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Db } from '../../lib/db';
import { renderText } from '../../lib/email/doc';
import { lintEmail, type LintRule } from '../../lib/email/lint';
import { checkFirstMessage, checkStrategy, type Strategy } from '../../lib/enrich/strategy';
import { chooseFirstEmail, prefillDraft, type PrefillInput, type RouteHint } from '../../modules/email/rules';
import type { Check } from './harness';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** The analysis the prefill must never carry: each is a pattern from the 3 Oct example or the guideline. */
const LEAKS: Array<[string, RegExp]> = [
  ['per our', /\bper our\b/i],
  ['read <date>', /\bread(?: on)? \d{1,2} [a-z]{3,9} \d{4}/i],
  ['(draft, nothing sent)', /\(draft, nothing sent\)/i],
  ['first message', /\bfirst message\b/i],
  ['note cited by author and date', /\((?:Juan|Mira|the team), \d{1,2} [A-Z][a-z]{2}/],
  ['then the position', /\bthen the position\b/i],
  ['template line', /I would like to tell you about|in the next couple of weeks/i],
  ['third person about the recipient', /\bhis field\b|\bher field\b|\bDana is\b|\bDana['’]s\b/i],
  ['an amount', /\$\s?\d|\b\d+\s?(?:m|mm|million)\b/i],
  ['portfolio round and date', /pre-seed, Nov 2025/i],
];
/** An intro ask talks about the LP to the connector, so third person there is no leak. */
const leaks = (text: string, intro = false) => LEAKS.filter(([name, re]) => !(intro && name.startsWith('third person')) && re.test(text)).map(([name]) => name);

/** The 3 Oct 2026 prefill, anonymised as in the guideline. */
const BAD_ANGLE = 'ML for biology is his field; Orrin Labs, a PLC Neurotech I portfolio company (pre-seed, Nov 2025, per our portfolio document), describes recording systems, cross-species datasets and foundation models of living organisms on its homepage (orrinlabs.example, read 30 Sep 2026); the team’s note (Juan, 26 Sep) puts its first applications in AI and robotics. Ask for a diligence conversation with Priya on whether organism recordings make better models, then the position. First message (draft, nothing sent), after the introduction: ‘Dana, Priya Raman leads our neurotech work. One of our portfolio companies, Orrin Labs, records living organisms to build cross-species datasets and foundation models. Would you spend 30 minutes with Priya on whether that data transfers to ML? There’s a small vehicle for individuals if it’s interesting.’';
const BAD_EMAIL = `Hi Dana,\n\n${BAD_ANGLE}\n\nI would like to tell you about Orrin Labs SPV. Would you have time for a short call in the next couple of weeks?\n\nBest,\nJuan`;

const CLEAN_FIRST = 'Hi Dana,\n\nThanks for taking the intro. You work on ML for biology, so I’d value your take on a question we keep coming back to. Orrin Labs records living organisms to build cross-species datasets and foundation models. Does data like that make better models, or just bigger ones?\n\nWould you spend 30 minutes with me on it next week?\n\nBest,\nPriya';
const CLEAN_INTRO = 'Hi Tomas,\n\nYou worked with Dana for years, so you’d know whether this is her kind of question. Orrin Labs records living organisms to build foundation models, and we’d value her view on whether that data helps ML.\n\nWould you ask her if she’d like an introduction? Only if she’s glad to. A short note you can forward is below.\n\nThanks,\nPriya';
const BLURB = 'Priya Raman leads neurotech work at Protocol Labs. She is looking at whether recordings of living organisms make better machine-learning models. She would value 30 minutes with Dana on it.';

/** Fragments a careless strategy writer might leave in a body, each one a guideline violation. */
const DIRT = [
  'per our portfolio document', '(read 30 Sep 2026)', 'First message (draft, nothing sent), after the introduction:',
  'ML for biology is his field.', 'Dana is a strong fit.', '(Juan, 26 Sep)', 'Ask for a meeting, then the position.',
  'I would like to tell you about the fund. Would you have time for a short call in the next couple of weeks?',
  'A check of $2M would fit.', 'Orrin Labs (pre-seed, Nov 2025) is in the portfolio.',
  'There is also a small vehicle for individuals.', 'Our fund backs Orrin Labs, and the Orrin Labs SPV is open.',
  ': ‘Dana, here is a long quoted message that we wrote for later and pasted in.’',
];

const FUND = { name: 'PLC Neurotech I', kind: 'fund' as const };
const SPV = { name: 'Orrin Labs SPV', kind: 'spv' as const };

export async function emailGuidelineProperties(check: Check, db: Db) {
  // ── 1. The prefill never carries analysis, whatever the strategy holds ───────────────
  {
    const r = rng(20261003);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    let runs = 0, fromStrategy = 0, empty = 0;
    const failures: string[] = [];
    for (let i = 0; i < 600; i++) {
      const intro = r() < 0.4;
      const vehicle = r() < 0.5 ? FUND : SPV;
      const dirty = r() < 0.6;
      const body = (intro ? CLEAN_INTRO : CLEAN_FIRST).split('\n\n');
      if (dirty) body.splice(1 + Math.floor(r() * (body.length - 2)), 0, pick(DIRT));
      const fm = r() < 0.15 ? undefined : {
        kind: intro ? 'intro_ask' : pick(['after_intro', 'cold', 'follow_up', 'reply']),
        from: 'Priya Raman', to: intro ? { name: 'Tomas Lindqvist' } : { name: 'Dana Whitfield' },
        subject: r() < 0.2 ? 'Re: per our notes' : intro ? 'Intro to Dana Whitfield?' : 'Organism recordings and ML',
        body: body.join('\n\n'), blurb: intro ? (r() < 0.2 ? `${BLURB} ${pick(DIRT)}` : BLURB) : null,
      };
      const p: PrefillInput = {
        purpose: intro ? 'intro_ask' : 'first_message', senderName: 'Juan Invented', vehicleName: vehicle.name, vehicleKind: vehicle.kind,
        otherVehicles: [vehicle === FUND ? SPV : FUND], lpName: 'Dana Whitfield', lpIsPerson: true,
        connectorName: intro ? 'Tomas Lindqvist' : null, connectorIsPerson: true,
        // The angle is the whole bad example: it must never reach the draft.
        strategy: r() < 0.1 ? null : { firstMessage: { ...fm, angle: BAD_ANGLE }, suggestionId: 's', madeAt: '2026-10-03' },
      };
      const out = prefillDraft(p);
      const text = `${out.subject}\n${renderText(out.doc)}`;
      runs++;
      if (out.prefill.source === 'strategy') fromStrategy++; else empty++;
      const found = [
        ...leaks(text, intro),
        ...lintEmail(text, { recipient: intro ? null : { name: 'Dana Whitfield', isPerson: true }, vehicle, otherVehicles: [vehicle === FUND ? SPV : FUND] })
          .filter((x) => !(vehicle === SPV && x.rule === 'mixed_vehicles' && /Orrin Labs SPV/.test(x.match))).map((x) => x.rule),
        ...(text.includes('organism recordings make better models, then') ? ['the angle'] : []),
      ];
      if (found.length) failures.push(`#${i} ${found.join(', ')}`);
    }
    check('Email guidelines: across 600 strategies, the prefill never carries a citation, a reading date, a note to ourselves, third person about the recipient, a template line, an amount or the angle',
      failures.length === 0 && fromStrategy > 50 && empty > 50,
      `${runs} drafts, ${fromStrategy} from a clean first message, ${empty} empty; ${failures.slice(0, 3).join(' · ') || 'no leaks'}`);
  }

  // ── 2. One vehicle per draft ─────────────────────────────────────────────────────────
  {
    const mixedFund = prefillDraft({ purpose: 'first_message', senderName: 'J', vehicleName: FUND.name, vehicleKind: 'fund', otherVehicles: [SPV], lpName: 'Dana Whitfield', lpIsPerson: true,
      strategy: { firstMessage: { kind: 'after_intro', from: 'Priya', to: { name: 'Dana Whitfield' }, subject: 'Neurotech', body: 'Hi Dana,\n\nWe are raising PLC Neurotech I. There is also an SPV for individuals.\n\nBest,\nPriya' }, suggestionId: 's', madeAt: 'x' } });
    const mixedSpv = prefillDraft({ purpose: 'first_message', senderName: 'J', vehicleName: SPV.name, vehicleKind: 'spv', otherVehicles: [FUND], lpName: 'Dana Whitfield', lpIsPerson: true,
      strategy: { firstMessage: { kind: 'after_intro', from: 'Priya', to: { name: 'Dana Whitfield' }, subject: 'Orrin Labs', body: 'Hi Dana,\n\nOrrin Labs, one of our portfolio companies, has an SPV open: the Orrin Labs SPV.\n\nBest,\nPriya' }, suggestionId: 's', madeAt: 'x' } });
    const cleanSpv = prefillDraft({ purpose: 'first_message', senderName: 'J', vehicleName: SPV.name, vehicleKind: 'spv', otherVehicles: [FUND], lpName: 'Dana Whitfield', lpIsPerson: true,
      strategy: { firstMessage: { kind: 'after_intro', from: 'Priya', to: { name: 'Dana Whitfield' }, subject: 'Orrin Labs', body: 'Hi Dana,\n\nOrrin Labs records living organisms. The Orrin Labs SPV invests in it alone.\n\nWould 30 minutes next week work?\n\nBest,\nPriya' }, suggestionId: 's', madeAt: 'x' } });
    check('Email guidelines: a draft names one vehicle — an SPV in a fund email or the fund’s portfolio in an SPV email sets the strategy’s draft aside; the SPV on its own is used',
      mixedFund.prefill.source === 'empty' && /SPV/.test(mixedFund.prefill.note) && mixedSpv.prefill.source === 'empty' && /portfolio compan/.test(mixedSpv.prefill.note)
        && cleanSpv.prefill.source === 'strategy' && !/PLC Neurotech I|portfolio/i.test(renderText(cleanSpv.doc)),
      JSON.stringify({ fund: mixedFund.prefill.note.slice(0, 120), spv: mixedSpv.prefill.note.slice(0, 120), clean: cleanSpv.prefill.source }));
  }

  // ── 3. The intro-ask kind picks the connector ────────────────────────────────────────
  {
    const r = rng(7);
    const tiers = ['A', 'B', 'C', 'D'] as const;
    let wrong = 0, intros = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const hasConn = r() < 0.7;
      const best: RouteHint | null = r() < 0.15 ? null : {
        holder: 'Priya Raman', tier: tiers[Math.floor(r() * 4)]!,
        connector: hasConn ? { entityId: `c-${i}`, name: 'Tomas Lindqvist' } : null,
      };
      const metUs = r() < 0.25;
      const withFm = r() < 0.3;
      const fm = withFm ? { kind: 'intro_ask', from: 'Priya Raman', to: { name: 'Tomas Lindqvist', key: `k-${i}` }, subject: 'Intro?', body: CLEAN_INTRO, blurb: BLURB } : null;
      const plan = chooseFirstEmail({ firstMessage: fm, best, metUs });
      n++;
      const strong = best && (best.tier === 'A' || best.tier === 'B');
      if (plan.purpose === 'intro_ask') intros++;
      if (withFm) { if (plan.purpose !== 'intro_ask' || plan.connector?.entityId !== `k-${i}` || plan.sender !== 'Priya Raman') wrong++; continue; }
      if (!metUs && strong && best!.connector) { if (plan.purpose !== 'intro_ask' || plan.connector?.entityId !== best!.connector.entityId || plan.sender !== 'Priya Raman') wrong++; }
      else if (plan.purpose === 'intro_ask') wrong++;
      if (strong && !metUs && plan.kind === 'cold') wrong++;
    }
    const empty = prefillDraft({ purpose: 'intro_ask', senderName: 'J', vehicleName: FUND.name, vehicleKind: 'fund', lpName: 'Dana Whitfield', lpIsPerson: true, connectorName: 'Tomas Lindqvist', connectorIsPerson: true, strategy: null });
    const fromFm = prefillDraft({ purpose: 'intro_ask', senderName: 'J', vehicleName: FUND.name, vehicleKind: 'fund', lpName: 'Dana Whitfield', lpIsPerson: true, connectorName: 'Tomas Lindqvist', connectorIsPerson: true,
      strategy: { firstMessage: { kind: 'intro_ask', from: 'Priya Raman', to: { name: 'Tomas Lindqvist' }, subject: 'Intro to Dana Whitfield?', body: CLEAN_INTRO, blurb: BLURB }, suggestionId: 's', madeAt: 'x' } });
    const toLp = prefillDraft({ purpose: 'intro_ask', senderName: 'J', vehicleName: FUND.name, vehicleKind: 'fund', lpName: 'Dana Whitfield', lpIsPerson: true, connectorName: 'Tomas Lindqvist', connectorIsPerson: true,
      strategy: { firstMessage: { kind: 'intro_ask', from: 'Priya Raman', to: { name: 'Dana Whitfield' }, subject: 'Hello', body: 'Hi Dana,\n\nCould we talk?\n\nBest,\nPriya', blurb: BLURB }, suggestionId: 's', madeAt: 'x' } });
    const fmText = renderText(fromFm.doc);
    check('Email guidelines: a route through someone to an LP who has not met us offers the intro ask to that connector, from the route holder, never a cold note; the intro ask greets the connector and carries the note to forward',
      wrong === 0 && intros > 50
        && /^Hi Tomas,/.test(renderText(empty.doc)) && empty.prefill.source === 'empty' && (empty.prefill.steps ?? []).some((x) => /forward/.test(x))
        && fromFm.prefill.source === 'strategy' && /^Hi Tomas,/.test(fmText) && fmText.trim().endsWith(BLURB) && fromFm.prefill.from === 'Priya Raman'
        && toLp.prefill.source === 'empty',
      JSON.stringify({ n, intros, wrong, empty: renderText(empty.doc).slice(0, 20), fromFm: fromFm.prefill.source, toLp: toLp.prefill.note.slice(0, 100) }));
  }

  // ── 4. The checker: optional, validated; the guideline's examples ────────────────────
  {
    const base: Strategy = {
      key: 'k-dana', name: 'Dana Whitfield', made: { at: '2026-10-03', by: 'fixture', workflow: 'W5', version: '1.11' },
      fit: { 'PLC Neurotech I': { verdict: 'good', why: 'Invented' } },
      scores: { capacity: { band: 'unknown', basis: 'Invented' }, affinity: { level: 'medium', basis: 'Invented' }, propensity: { level: 'low', basis: 'Invented' }, timeToDecision: { band: 'unknown', basis: 'Invented' } },
      angle: BAD_ANGLE, route: { via: 'Priya Raman → Tomas Lindqvist', tier: 'B', why: 'Invented' },
      next: { what: 'Priya asks Tomas for the introduction', who: 'Priya', when: 'this week' },
      ask: { vehicle: 'spv-orrin-labs', shape: 'SPV' }, openQuestions: [], risks: [], list: '2027', confidence: 'low',
    };
    const without = checkStrategy(base);
    const good = checkStrategy({ ...base, firstMessage: { kind: 'intro_ask', from: 'Priya Raman', to: { name: 'Tomas Lindqvist', key: 'k-tomas' }, subject: 'Intro to Dana Whitfield?', body: CLEAN_INTRO, blurb: BLURB } });
    const bad = checkFirstMessage({ ...base, firstMessage: { kind: 'after_intro', from: 'Juan', to: { name: 'Dana Whitfield', key: 'k-dana' }, subject: 'Orrin Labs SPV', body: BAD_EMAIL } });
    const cold = checkFirstMessage({ ...base, firstMessage: { kind: 'cold', from: 'Juan', to: { name: 'Dana Whitfield' }, subject: 'Hello', body: CLEAN_FIRST.replace('Thanks for taking the intro. ', '') } });
    const introToLp = checkFirstMessage({ ...base, firstMessage: { kind: 'intro_ask', from: 'Priya Raman', to: { name: 'Dana Whitfield', key: 'k-dana' }, subject: 'Hi', body: 'Hi Dana,\n\nCould we talk?\n\nBest,\nPriya', blurb: BLURB } });
    const malformed = checkStrategy({ ...base, firstMessage: { kind: 'pitch', body: '' } as unknown as Strategy['firstMessage'] });
    const has = (ps: string[], re: RegExp) => ps.some((x) => re.test(x));
    check('Email guidelines: firstMessage is optional and validated — a clean intro ask passes; the 3 Oct draft, a cold note beside a warm route, an intro ask to the LP and a malformed field are refused',
      without.length === 0 && good.length === 0
        && has(bad, /citation/) && has(bad, /third person/) && has(bad, /two messages|second message/) && has(bad, /template/) && has(bad, /portfolio compan|fund/)
        && has(cold, /cold note while the route/) && has(introToLp, /goes to the connector/) && has(malformed, /kind must be/) && has(malformed, /needs a body/),
      JSON.stringify({ without, good, bad: bad.length, cold, introToLp: introToLp.slice(0, 2), malformed: malformed.slice(0, 3) }));

    // The guideline's own examples: every good one passes the lint, and the bad one trips the rules it names.
    const doc = await readFile('docs/email-guidelines.md', 'utf8');
    const quoted: string[] = [];
    let cur: string[] | null = null;
    for (const line of `${doc}\n`.split('\n')) {
      if (line.startsWith('>')) (cur ??= []).push(line.replace(/^> ?/, ''));
      else if (cur) { quoted.push(cur.join('\n').replace(/^Subject: [^\n]*\n\n?/, '').trim()); cur = null; }
    }
    const badBlock = quoted.find((b) => b.includes('his field'))!;
    const goods = quoted.filter((b) => b !== badBlock);
    const goodIssues = goods.flatMap((b) => {
      const to = /^Hi (\w+)/.exec(b)?.[1] ?? null;
      const intro = /introduction\? Only if/.test(b);
      const vehicle = /SPV/.test(b) ? { name: 'Orrin Labs SPV', kind: 'spv' as const } : { name: 'PLC Neurotech I', kind: 'fund' as const };
      return lintEmail(b, { recipient: intro ? null : { name: to, isPerson: true }, vehicle, maxWords: 200 }).map((x) => `${to}: ${x.rule} “${x.match}”`);
    });
    const badRules = new Set<LintRule>(lintEmail(badBlock, { recipient: { name: 'Jordan', isPerson: true } }).map((x) => x.rule));
    check('Email guidelines: the guideline’s good examples pass every check, and its bad example trips citation, analysis, third person, two messages, template, private detail and mixed vehicles',
      goods.length >= 5 && goodIssues.length === 0 && ['citation', 'analysis', 'third_person', 'two_messages', 'template', 'private', 'mixed_vehicles'].every((x) => badRules.has(x as LintRule)),
      `${goods.length} good examples; issues: ${goodIssues.slice(0, 4).join(' · ') || 'none'}; bad trips ${[...badRules].join(', ')}`);
  }

  // ── 5. Drafts from records: the strategy's field, the sender, and each person's voice ─
  {
    const email = await import('../../modules/email');
    const users = await db.query<{ id: string; handle: string; name: string; email: string }>(
      "select id::text, handle, name, email from platform.app_user where active and access in ('admin','team') order by handle = 'juan' desc, handle limit 2");
    const [me, other] = users as [typeof users[number], typeof users[number]];
    const actor = { id: me.id, handle: me.handle, name: me.name, email: me.email };
    const fund = (await db.one<{ id: string; name: string }>("select id::text, name from platform.vehicle where kind = 'fund' and phase <> 'historical' order by sort_order limit 1"))!;
    const lp = randomUUID(), connector = randomUUID();
    await db.query("insert into identity.entity(entity_id, entity_type, display_name) values ($1, 'person', 'Dana Whitfield'), ($2, 'person', 'Tomas Lindqvist')", [lp, connector]);
    const pursuit = (await db.one<{ id: string }>("insert into strategy.pursuit(entity_id, vehicle_id, owner_id, status) values ($1, $2, $3, 'selected') returning pursuit_id::text id", [lp, fund.id, me.id]))!.id;
    const suggest = async (fm: unknown, tag: string) => {
      await db.query("update strategy.suggestion set status = 'withdrawn' where pursuit_id = $1 and status = 'proposed'", [pursuit]);
      await db.query(`insert into strategy.suggestion(pursuit_id, body, data, made_by, made_at, file_hash) values ($1, 'Invented next step', $2, 'fixture', now(), $3)`,
        [pursuit, JSON.stringify({ angle: BAD_ANGLE, ask: { vehicle: fund.name, shape: 'fund commitment', range: '$2–4M, an estimate' }, ...(fm ? { firstMessage: fm } : {}) }), tag]);
    };
    const bodyOf = async (id: string) => (await email.draftWithChecks(actor, id));

    await suggest(null, 'eg-none');
    const plain = await bodyOf(await email.createDraft(actor, { purpose: 'first_message', vehicleId: fund.id, pursuitId: pursuit }));
    await suggest({ kind: 'after_intro', from: 'Priya Raman', to: { name: 'Dana Whitfield', key: lp }, subject: 'Organism recordings and ML', body: CLEAN_FIRST }, 'eg-clean');
    const clean = await bodyOf(await email.createDraft(actor, { purpose: 'first_message', vehicleId: fund.id, pursuitId: pursuit }));
    await suggest({ kind: 'intro_ask', from: 'Priya Raman', to: { name: 'Tomas Lindqvist', key: connector }, subject: 'Intro to Dana Whitfield?', body: CLEAN_INTRO, blurb: BLURB }, 'eg-intro');
    const intro = await bodyOf(await email.createDraft(actor, { purpose: 'intro_ask', vehicleId: fund.id, pursuitId: pursuit, connectorId: connector }));
    const texts = [plain, clean, intro].map((d) => `${d.draft.subject}\n${d.draft.bodyText}`);
    check('Email guidelines: a draft started on an LP page uses the strategy’s first message and nothing else — empty with the structure when there is none, never its angle or money range; an intro ask goes to the connector',
      plain.draft.prefill?.source === 'empty' && (plain.draft.prefill?.steps?.length ?? 0) >= 3 && plain.draft.subject === ''
        && clean.draft.prefill?.source === 'strategy' && clean.draft.bodyText.trim() === CLEAN_FIRST
        && intro.draft.prefill?.source === 'strategy' && intro.draft.connectorId === connector && /^Hi Tomas,/.test(intro.draft.bodyText) && intro.draft.bodyText.includes(BLURB)
        && texts.every((t, i) => leaks(t, i === 2).length === 0 && !t.includes('portfolio document') && !/\$2/.test(t)),
      JSON.stringify({ plain: plain.draft.prefill?.source, clean: clean.draft.prefill?.source, intro: intro.draft.prefill?.source, leaks: texts.map((t, i) => leaks(t, i === 2)) }));
    check('Email guidelines: a draft the strategy gives to another sender says so to its owner (who sends is the route holder)',
      clean.warnings.some((w) => w.rule === 'sender' && /Priya Raman/.test(w.text)) && !plain.warnings.some((w) => w.rule === 'sender'),
      JSON.stringify(clean.warnings.map((w) => w.rule)));

    // A typed draft that breaks the guidelines is warned about, never blocked.
    await email.saveDraft(actor, plain.draft.draftId, { revision: plain.draft.revision, to: 'dana@example.org', cc: '', bcc: '', subject: 'Neurotech', mode: 'plain', text: BAD_EMAIL });
    const typed = await bodyOf(plain.draft.draftId);
    check('Email guidelines: a typed draft that pastes in analysis gets a guidelines check beside the Move button, and no block',
      typed.warnings.some((w) => w.rule === 'guidelines' && w.level === 'check' && /citation|our own records/.test(w.text)) && !typed.blocks.some((b) => b.field === 'body'),
      typed.warnings.filter((w) => w.rule === 'guidelines').map((w) => w.text.slice(0, 140)).join(' · '));

    // The voice: one's own, stored per person; the audit keeps lengths, never words; empty deletes it.
    const words = 'Short and plain. First name. Signs off Best, P.';
    const saved = await email.saveVoice(actor, { style: words, samples: ['Hi Ana,\n\nThanks for Tuesday.\n\nBest,\nP', '  ', 'Hi Bo,\n\nOne question.\n\nBest,\nP'] });
    const theirs = other ? await email.voiceOf({ id: other.id }) : { style: '', samples: [] };
    let tooMany = false;
    try { await email.saveVoice(actor, { style: '', samples: ['a', 'b', 'c', 'd', 'e', 'f'] }); } catch (e) { tooMany = e instanceof email.DraftRefused; }
    const voiced = await email.draftWithChecks(actor, clean.draft.draftId);
    const audit = await db.query<{ action: string; detail: Record<string, unknown> }>("select action, detail from platform.audit_log where subject_type = 'app_user' and subject_id = $1 and action like 'email.voice_%' order by at", [me.id]);
    const wiped = await email.saveVoice(actor, { style: ' ', samples: [] });
    const row = await db.one<{ n: number }>('select count(*)::int n from email.voice where user_id = $1', [me.id]);
    const audit2 = await db.query<{ action: string }>("select action from platform.audit_log where subject_type = 'app_user' and subject_id = $1 and action like 'email.voice_%' order by at", [me.id]);
    check('Email guidelines: a voice is its owner’s alone — saved with its blank samples dropped, not seen by anyone else, at most five samples, audited by length only, and deleted by saving it empty',
      saved.style === words && saved.samples.length === 2 && theirs.style === '' && theirs.samples.length === 0 && tooMany && voiced.draft.ownerId === me.id
        && audit.length === 1 && audit[0]!.detail.styleChars === words.length && audit[0]!.detail.samples === 2 && !JSON.stringify(audit).includes('Thanks for Tuesday')
        && wiped.style === '' && wiped.samples.length === 0 && row?.n === 0 && audit2.map((a) => a.action).join(' ') === 'email.voice_saved email.voice_deleted',
      JSON.stringify({ saved: saved.samples.length, theirs: theirs.samples.length, tooMany, audit, after: audit2.map((a) => a.action), rows: row?.n }));

    // Leave the shared database as it was: the drafts discarded, the suggestions withdrawn.
    await db.query("update email.draft set status = 'discarded' where pursuit_id = $1", [pursuit]);
    await db.query("update strategy.suggestion set status = 'withdrawn' where pursuit_id = $1", [pursuit]);
  }
}
