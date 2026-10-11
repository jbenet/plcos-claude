import Link from '@/components/ui/AppLink';
import { shortDate } from '@/lib/time';
import { capacityBandLabel } from '@/lib/capacity-bands';
import { mentionsHealthDetail } from '@/lib/redact-health';
import { RUNG_LABEL, STATUS_LABEL } from '@/lib/authz/read/strategy';
import { RUNGS, rungIndex } from '@/modules/strategy';
import { CHANNEL_LABEL } from '@/modules/meetings';
import { chooseFirstEmail, KIND_LABEL } from '@/modules/email';
import { EmailDrafts } from '@/components/email/EmailDrafts';
import { SuggestedStrategy } from '@/components/strategy/SuggestedStrategy';
import { decideSuggestionAction } from '@/app/targets/actions';
import type { Strategy } from '@/lib/enrich/strategy';
import type { LpData } from './lp-data';
import s from './lp.module.css';

/**
 * The pieces the compared LP page designs share (11 Oct 2026, docs/strategy/lp-pages.md). One rule runs through
 * them: one line per answer, the full text on hover or a click away, no explainer paragraphs, nothing empty shown.
 */

export type Design = 'a' | 'b' | 'c';

export const DESIGN_LABEL: Record<Design, string> = { a: 'A · Brief and tabs', b: 'B · Conversation first', c: 'C · Dossier' };

/** The bar on every trial page: which design this is, and the others to compare with. */
export function DesignBar({ id, current }: { id: string; current: Design }) {
  return (
    <nav className={s.designbar} aria-label="Compare LP page designs">
      <span className={s.dlabel}>Design trial</span>
      <Link href={`/targets/${id}`}>Current page</Link>
      {(['a', 'b', 'c'] as Design[]).map((d) => d === current
        ? <b key={d} aria-current="page">{DESIGN_LABEL[d]}</b>
        : <Link key={d} href={`/targets/${id}/${d}`}>{DESIGN_LABEL[d]}</Link>)}
    </nav>
  );
}

/** A line cut to fit, the whole text on hover. */
export function Clip({ text, lines = 1, className }: { text: string | null | undefined; lines?: 1 | 2 | 3; className?: string }) {
  if (!text) return null;
  return <span className={`${s.clip} ${s[`l${lines}`]} ${className ?? ''}`} title={text}>{text}</span>;
}

/** An explanation folded into one mark: it shows on hover, and reads aloud. */
export function Info({ text }: { text: string }) {
  return <abbr className={s.info} title={text} aria-label={text}>i</abbr>;
}

export function Ladder({ rung }: { rung: LpData['pursuit']['rung'] }) {
  const at = rungIndex(rung);
  return (
    <span className={s.ladder} title={`On the ladder: ${rung ? RUNG_LABEL[rung] : 'nothing yet'}`} aria-label={`On the ladder: ${rung ? RUNG_LABEL[rung] : 'nothing yet'}`}>
      {RUNGS.map((r, i) => <i key={r} className={i <= at ? s.on : undefined} />)}
    </span>
  );
}

/** The name and one row of chips: status with the ladder, money, the last word, and every flag. */
export function Head({ d }: { d: LpData }) {
  const p = d.pursuit;
  const from = p.statusSource === 'us' ? `set here${p.statusSetAt ? ` ${shortDate(p.statusSetAt)}` : ''}` : `from Affinity${p.stageSaid ? ` “${p.stageSaid}”` : ''}`;
  return (
    <header className={s.head}>
      <div className={s.crumb}>{p.vehicleName}</div>
      <h1 className={s.name}><Link href={`/orgs/${p.entityId}`}>{p.entityName}</Link></h1>
      {p.headline && <Clip text={p.headline} className={s.sub} />}
      <div className={s.chips}>
        <span className={`${s.chip} ${s.cg}`} title={`Status ${from}`}>{STATUS_LABEL[p.status]} <Ladder rung={p.rung} /></span>
        {d.money.map((m) => <span key={m} className={s.chip}>{m}</span>)}
        {d.owes?.by === 'us' && <span className={`${s.chip} ${s.ca}`}>We owe a reply · {shortDate(d.owes.since)}</span>}
        {d.owes?.by === 'them' && <span className={s.chip}>They owe a reply · {shortDate(d.owes.since)}</span>}
        {d.restrictions.map((r) => (
          <span key={r.restrictionId} className={`${s.chip} ${s.cr}`} title={r.instruction}>
            {r.scope === 'blanket' ? 'Do not approach' : r.scope === 'channel' ? `Not by ${r.channel ?? 'this channel'}` : `Not through ${r.connectorName ?? 'a connector'}`}
          </span>
        ))}
        {d.kind === 'spv' && d.spv?.stance === 'does-not' && <span className={`${s.chip} ${s.ca}`}>Doesn’t do SPVs</span>}
        {d.needsEvidence && <span className={`${s.chip} ${s.cm}`} title={`${STATUS_LABEL[p.status]} claims ${RUNG_LABEL[d.needsEvidence]}; the ladder hasn’t confirmed it`}>Needs evidence</span>}
        {d.others.map((o) => <Link key={o.pursuitId} href={`/targets/${o.pursuitId}`} className={s.chip}>{o.name} · {o.status}</Link>)}
      </div>
    </header>
  );
}

const LEVEL: Record<string, string> = { high: 'high', medium: 'medium', low: 'low', unknown: '?' };

/** The four answers: why they'd care, what's next, the way in, the ask. */
export function Plan({ d, compact = false }: { d: LpData; compact?: boolean }) {
  const st = d.strategy?.data ?? null;
  const p = d.pursuit;
  const next = p.nextStep ? { what: p.nextStep, meta: p.nextStepOn ? `by ${shortDate(p.nextStepOn)}` : null, suggested: false }
    : st ? { what: st.next.what, meta: [st.next.who, st.next.when].filter(Boolean).join(' · ') || null, suggested: d.strategy!.status === 'proposed' } : null;
  return (
    <dl className={s.plan}>
      {st?.angle && !compact && <><dt>Why</dt><dd><Clip text={st.angle} lines={2} /></dd></>}
      <dt>Next</dt>
      <dd>{next ? <><Clip text={next.what} lines={2} className={s.strong} /> {next.meta && <span className={s.m}>{next.meta}</span>}{next.suggested && <span className={s.m}> · suggested</span>}</> : <span className={s.m}>None set</span>}</dd>
      <dt>Way in</dt>
      <dd>{d.best ? <><span className={`tier t${d.best.weakestTier}`}>{d.best.weakestTier}</span> {[d.best.fromName ?? d.routes?.fromName, ...d.best.hops.map((h) => h.toName)].filter(Boolean).join(' → ')}</>
        : st?.route ? <><span className={`tier t${st.route.tier}`}>{st.route.tier}</span> <Clip text={st.route.via} /></>
          : <span className={s.m}>No route found <Info text="No supported route in the material available. That is not the same as none existing." /></span>}</dd>
      {st && <><dt>Ask</dt><dd>{st.ask.shape}{st.ask.range ? ` · ${st.ask.range}` : ''} <span className={s.m}>· {st.list === 'this year' ? 'this year' : st.list === '2027' ? '2027' : 'not now'}</span></dd></>}
    </dl>
  );
}

/** Accept the strategy's next step: the same action as the strategy card, writing the next step and nothing else. */
export function AcceptNext({ d }: { d: LpData }) {
  if (d.strategy?.status !== 'proposed') return null;
  return (
    <form action={decideSuggestionAction} className={s.inline}>
      <input type="hidden" name="suggestionId" value={d.strategy.suggestionId} />
      <input type="hidden" name="pursuitId" value={d.pursuit.pursuitId} />
      <button className="btn" name="decision" value="accept" type="submit">Accept next step</button>
    </form>
  );
}

const ARROW: Record<string, string> = { ours: '→', theirs: '←', both: '↔' };

/** One line per touch, newest first. A note that mentions someone's health lends no words (N56). */
export function Feed({ d, limit = 8 }: { d: LpData; limit?: number }) {
  const rows = d.feed.slice(0, limit);
  if (!rows.length) return <p className={s.m}>No contact on record.</p>;
  return (
    <ul className={s.feed}>
      {rows.map((t) => {
        const text = t.subject ?? t.summary ?? '';
        const health = mentionsHealthDetail(text);
        const when = t.on ?? t.scheduledFor!;
        return (
          <li key={t.touchpointId} className={t.counted ? undefined : s.dim}>
            <span className={s.date}>{shortDate(when)}</span>
            <span className={s.arrow} aria-label={t.direction ?? ''}>{t.direction ? ARROW[t.direction] : '·'}</span>
            <span className={s.what}>
              <span className={s.m}>{t.on ? CHANNEL_LABEL[t.channel] : `${CHANNEL_LABEL[t.channel]}, scheduled`}{t.vehicleName && !t.counted ? ` · ${t.vehicleName}` : ''}</span>{' '}
              {health ? <span className={s.m}>mentions someone’s health; open the full timeline</span> : <Clip text={text} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A strategy in a few lines, the scores on one, the full card a click away. */
export function StrategyShort({ d, pursuitId, vehicleName, data, status, madeBy, madeAt }: {
  d: LpData; pursuitId: string; vehicleName: string; data: Strategy; status: string; madeBy: string; madeAt: Date;
}) {
  const sc = data.scores;
  const stale = pursuitId === d.pursuit.pursuitId && d.newer.length > 0;
  return (
    <section className={`card ${s.short}`}>
      <div className="chead"><h2>{vehicleName}</h2><span className="lbl">{status === 'proposed' ? 'to review' : status} · {shortDate(madeAt)} <Info text={`Written by ${madeBy}`} /></span></div>
      <div className={s.pad}>
        {stale && <p className={s.stale}>{d.newer.length} {d.newer.length === 1 ? 'touch' : 'touches'} since it was written, latest {shortDate(d.newer[0]!.on!)}</p>}
        <dl className={s.plan}>
          <dt>Why</dt><dd><Clip text={data.angle} lines={2} /></dd>
          <dt>Next</dt><dd><Clip text={data.next.what} lines={2} className={s.strong} /> <span className={s.m}>{[data.next.who, data.next.when].filter(Boolean).join(' · ')}</span></dd>
          <dt>Ask</dt><dd>{data.ask.shape}{data.ask.range ? ` · ${data.ask.range}` : ''}</dd>
          <dt>Scores</dt><dd>Capacity {capacityBandLabel(sc.capacity.band)} · affinity {LEVEL[sc.affinity.level]} · propensity {LEVEL[sc.propensity.level]} · timing {sc.timeToDecision.band} <Info text={[sc.capacity.basis, sc.affinity.basis, sc.propensity.basis, sc.timeToDecision.basis].join('\n\n')} /></dd>
        </dl>
        {(data.risks.length > 0 || data.openQuestions.length > 0) && (
          <div className={s.chips}>
            {data.risks.slice(0, 3).map((r, i) => <span key={i} className={`${s.chip} ${s.ca} ${s.cut}`} title={r}>{r}</span>)}
            {data.risks.length > 3 && <span className={s.chip}>+{data.risks.length - 3} risks</span>}
            {data.openQuestions.length > 0 && <span className={s.chip} title={data.openQuestions.join('\n')}>{data.openQuestions.length} to find out</span>}
          </div>
        )}
        <details className={s.more}><summary>Full strategy</summary><SuggestedStrategy pursuitId={pursuitId} vehicleName={vehicleName} /></details>
      </div>
    </section>
  );
}

/** Every strategy on file for them: this vehicle's first. */
export function Strategies({ d }: { d: LpData }) {
  const list = [
    ...(d.strategy ? [{ pursuitId: d.pursuit.pursuitId, vehicleName: d.pursuit.vehicleName, s: d.strategy }] : []),
    ...d.strategyOthers.map((o) => ({ pursuitId: o.pursuitId, vehicleName: o.vehicleName, s: o.s! })),
  ];
  if (!list.length) return <p className={s.m}>No strategy written yet.</p>;
  return <>{list.map((x) => <StrategyShort key={x.pursuitId} d={d} pursuitId={x.pursuitId} vehicleName={x.vehicleName}
    data={x.s.data as unknown as Strategy} status={x.s.status} madeBy={x.s.madeBy} madeAt={x.s.madeAt} />)}</>;
}

/** The routes in, one line each. */
export function Routes({ d, limit = 5 }: { d: LpData; limit?: number }) {
  return (
    <>
      {d.routeList.length === 0 ? <p className={s.m}>No route found <Info text="No supported route from the team or PL in the material available. That is not the same as none existing." /></p> : (
        <ul className={s.feed}>
          {d.routeList.slice(0, limit).map((r, i) => (
            <li key={i} className={s.route}>
              <span className={`tier t${r.weakestTier}`}>{r.weakestTier}</span>
              <span className={s.what}><Clip text={[r.fromName ?? d.routes?.fromName, ...r.hops.map((h) => h.toName)].filter(Boolean).join(' → ')} /> <Info text={r.reasons[0] ?? ''} /></span>
            </li>
          ))}
        </ul>
      )}
      <p className={s.m} style={{ fontSize: 12 }}>
        {d.routes ? `${d.routes.coverage.edges} ties searched, up to ${d.routes.coverage.maxHops} hops · ` : ''}
        <Link href={`/routes?target=${d.pursuit.entityId}`}>All routes</Link>
      </p>
    </>
  );
}

/** The Email card with a one-line lede: drafts go to the sender's own Gmail; nothing sends here. */
export function Compose({ d, path }: { d: LpData; path: string }) {
  const p = d.pursuit;
  const plan = chooseFirstEmail({
    firstMessage: (d.strategy?.data as { firstMessage?: unknown } | undefined)?.firstMessage ?? null,
    best: d.best ? { holder: d.best.fromName ?? d.routes?.fromName ?? null, connector: d.best.connectorIds[0] ? { entityId: d.best.connectorIds[0], name: d.best.connectorNames[0] ?? 'the connector' } : null, tier: d.best.weakestTier } : null,
    metUs: d.summary.meetingDates.length > 0 || Boolean(d.summary.lastFromThem),
  });
  const intro = plan.purpose === 'intro_ask' && plan.connector;
  return (
    <EmailDrafts
      title="Email"
      lede={`${KIND_LABEL[plan.kind]}${plan.sender ? `, from ${plan.sender}` : ''}.`}
      where={{ pursuitId: p.pursuitId }}
      create={intro ? { purpose: 'intro_ask', vehicleId: p.vehicleId, pursuitId: p.pursuitId, connectorId: plan.connector!.entityId } : { purpose: 'first_message', vehicleId: p.vehicleId, pursuitId: p.pursuitId }}
      path={path}
      startLabel={intro ? `Draft the intro ask to ${plan.connector!.name}` : 'Draft the email'}
      alternative={intro ? { label: 'Write to them directly', create: { purpose: 'first_message', vehicleId: p.vehicleId, pursuitId: p.pursuitId } } : null}
    />
  );
}

/** Facts on file, one line each with the source on hover. Public-source facts are left to the research card. */
export function Facts({ d, limit = 6 }: { d: LpData; limit?: number }) {
  const own = d.claims.filter((c) => !c.field.startsWith('public.')).slice(0, limit);
  const pub = d.claims.filter((c) => c.field.startsWith('public.')).slice(0, Math.max(0, limit - own.length));
  const rows = [...own, ...pub];
  if (!rows.length) return <p className={s.m}>Nothing on file.</p>;
  return (
    <ul className={s.facts}>
      {rows.map((c) => (
        <li key={c.claimId} title={`${c.provenance.source} · as of ${shortDate(c.provenance.asOf)} · ${c.provenance.confidence}${c.provenance.lastVerifiedBy ? ` · verified by ${c.provenance.lastVerifiedBy}` : ' · unverified'}`}>
          <Clip text={c.value} />
        </li>
      ))}
    </ul>
  );
}
