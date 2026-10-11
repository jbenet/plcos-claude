import Link from '@/components/ui/AppLink';
import { shortDate } from '@/lib/time';
import { stepDue, type Strategy } from '@/lib/enrich/strategy';
import { decideSuggestionAction } from '@/app/targets/actions';
import s from './lp-brief.module.css';

/**
 * The plan for one LP on one vehicle, first on the LP page (thread "LP pages + strategy", 11 Oct 2026;
 * docs/strategy/lp-pages.md). Before it, the page opened on the status and a 4,000 px column of cards, and the
 * strategy W5 wrote sat under the timeline, where nobody reading the page in a minute reached it.
 *
 * It reads what the page has already gathered and decides nothing: the next step a person set leads, the
 * strategy's own next step is shown as suggested until someone accepts it, the way in is the route search's best
 * recommended route, and the flags are the ones the cards below carry in full. Restrictions are always shown,
 * in red (rule 8). Accepting the suggested next step is the same action as the strategy card's: it writes the
 * pursuit's next step and nothing else.
 */

export interface BriefFlag { tone: 'stop' | 'warn' | 'info'; text: string; href?: string }

export interface BriefRoute { path: string; tier: string; href: string }

export interface BriefProps {
  pursuitId: string;
  vehicleName: string;
  /** What a person set as the next step, with its date. */
  nextStep: { what: string; on: Date | null } | null;
  strategy: {
    suggestionId: string; status: 'proposed' | 'accepted' | 'dismissed' | 'withdrawn';
    madeBy: string; madeAt: Date; decidedByName: string | null; data: Strategy;
  } | null;
  route: BriefRoute | null;
  routesHref: string;
  /** Who owes the next word on this vehicle, from the comms trace. */
  owes: { by: 'us' | 'them'; since: Date } | null;
  lastTouch: Date | null;
  /** What happened after the strategy was written: touches with them, and the team's notes. */
  since: { touches: number; fromThem: number; latest: Date | null; notes: number } | null;
  /** What they indicated, and where the money stands, as one line each when there is one. */
  money: string[];
  flags: BriefFlag[];
  /** Links to the other pages about this LP. */
  links: Array<{ label: string; href: string }>;
  today: Date;
}

const LIST_LABEL: Record<Strategy['list'], string> = { 'this year': 'this year’s close', '2027': 'the 2027 pipeline', 'not now': 'not now' };

export function LpBrief(p: BriefProps) {
  const st = p.strategy && p.strategy.status !== 'dismissed' && p.strategy.status !== 'withdrawn' ? p.strategy : null;
  const sd = st?.data ?? null;
  const proposed = st?.status === 'proposed';
  // A person's next step leads; the strategy's is shown beside it only when it says something else.
  const suggestedNext = sd && (!p.nextStep || (proposed && sd.next.what.trim() !== p.nextStep.what.trim())) ? sd.next : null;
  const due = p.nextStep?.on ?? null;
  const overdue = due && due.getTime() < p.today.getTime() - 86_400_000;
  const suggestedDue = suggestedNext && st ? stepDue(suggestedNext.when, st.madeAt.toISOString()) : null;
  const suggestedLate = suggestedDue && suggestedDue.getTime() < p.today.getTime() - 86_400_000;
  const stale = p.since && (p.since.touches > 0 || p.since.notes > 0);

  return (
    <section className={`card ${s.brief}`} id="plan" aria-labelledby="plan-h" data-lp-brief>
      <div className="chead">
        <h2 id="plan-h">The plan</h2>
        <span className="lbl">
          {sd ? <>for {p.vehicleName} · {st!.madeBy}, {shortDate(st!.madeAt)}{proposed ? ' · ready for review' : st!.status === 'accepted' ? ` · accepted${st!.decidedByName ? ` by ${st!.decidedByName}` : ''}` : ''}</> : `for ${p.vehicleName} · no strategy written yet`}
        </span>
      </div>

      {p.flags.some((f) => f.tone === 'stop') && (
        <div className={s.stop} role="alert">
          {p.flags.filter((f) => f.tone === 'stop').map((f, i) => <p key={i}>{f.text}</p>)}
        </div>
      )}

      <div className={s.body}>
        {sd?.angle && <p className={s.angle}><b>Why they’d care.</b> {sd.angle}</p>}

        <dl className={s.rows}>
          <dt>Next</dt>
          <dd>
            {p.nextStep ? (
              <>
                <b>{p.nextStep.what}</b>
                {due && <span className={overdue ? s.late : s.muted}> · {overdue ? `was due ${shortDate(due)}` : `by ${shortDate(due)}`}</span>}
              </>
            ) : !suggestedNext ? <span className={s.muted}>Nobody has set a next step.</span> : null}
            {suggestedNext && (
              <div className={p.nextStep ? s.alt : undefined}>
                {p.nextStep && <span className={s.muted}>The strategy suggests: </span>}
                <b>{suggestedNext.what}</b>
                <span className={s.muted}> — {suggestedNext.who}{suggestedNext.when ? `, ${suggestedNext.when}` : ''}{suggestedNext.material ? ` · with ${suggestedNext.material}` : ''}</span>
                {suggestedLate && <span className={s.late}> · past its date</span>}
                {suggestedNext.lookAgain && <span className={s.muted}> · parked: look again {suggestedNext.lookAgain}</span>}
                {proposed && <span className={s.muted}> · suggested, not accepted</span>}
              </div>
            )}
          </dd>

          <dt>Way in</dt>
          <dd>
            {p.route ? (
              <>
                <span className={`tier t${p.route.tier}`}>{p.route.tier}</span> {p.route.path}
                <span className={s.muted}> · the best recommended route · </span>
                <Link href={p.route.href}>all routes</Link>
              </>
            ) : sd?.route ? (
              <>
                <span className={`tier t${sd.route.tier}`}>{sd.route.tier}</span> {sd.route.via}
                <span className={s.muted}> · from the strategy; the route search has no recommended route</span>{' '}
                <Link href={p.routesHref}>search routes</Link>
              </>
            ) : (
              <><span className={s.muted}>No supported route in the material available, which is not the same as none. </span><Link href={p.routesHref}>Find a warm intro</Link></>
            )}
          </dd>

          {(sd || p.money.length > 0) && (
            <>
              <dt>The ask</dt>
              <dd>
                {sd && <>{sd.ask.shape}{sd.ask.range ? ` · ${sd.ask.range}` : ''}{sd.ask.unit ? <span className={s.muted}> · from {sd.ask.unit}</span> : null}<span className={s.muted}> · for {LIST_LABEL[sd.list]}, confidence {sd.confidence}</span></>}
                {p.money.map((m, i) => <div key={i} className={sd || i > 0 ? s.alt : undefined}>{m}</div>)}
              </dd>
            </>
          )}

          <dt>Last word</dt>
          <dd>
            {p.owes?.by === 'us' ? <b className={s.late}>We owe them a reply, since {shortDate(p.owes.since)}</b>
              : p.owes?.by === 'them' ? <>They owe us a reply, since {shortDate(p.owes.since)}</>
                : p.lastTouch ? <>Nobody owes a reply<span className={s.muted}> · last touch {shortDate(p.lastTouch)}</span></>
                  : <span className={s.muted}>No touch on record for {p.vehicleName}.</span>}
          </dd>
        </dl>

        {stale && (
          <p className={s.stale}>
            <b>Written before the latest.</b> Since {shortDate(st!.madeAt)}:{' '}
            {[
              p.since!.touches ? `${p.since!.touches} ${p.since!.touches === 1 ? 'touch' : 'touches'}${p.since!.fromThem ? ` (${p.since!.fromThem} from them)` : ''}, the latest ${shortDate(p.since!.latest!)}` : null,
              p.since!.notes ? `${p.since!.notes} ${p.since!.notes === 1 ? 'note' : 'notes'} from the team` : null,
            ].filter(Boolean).join('; ')}. Read it against the timeline; the next strategy pass reads them first.
          </p>
        )}

        {p.flags.some((f) => f.tone !== 'stop') && (
          <ul className={s.flags} aria-label="Worth knowing">
            {p.flags.filter((f) => f.tone !== 'stop').map((f, i) => (
              <li key={i} className={f.tone === 'warn' ? s.warn : undefined}>
                {f.href ? <Link href={f.href}>{f.text}</Link> : f.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={s.acts}>
        <a className="btn p" href="#email">Draft an email</a>
        <a className="btn" href="#timeline">Add an update</a>
        {proposed && st && (
          <form action={decideSuggestionAction} className={s.accept}>
            <input type="hidden" name="suggestionId" value={st.suggestionId} />
            <input type="hidden" name="pursuitId" value={p.pursuitId} />
            <button className="btn" name="decision" value="accept" type="submit">Accept the suggested next step</button>
          </form>
        )}
        <span className={s.links}>
          {sd && <a href="#strategy">The full strategy</a>}
          {p.links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </span>
      </div>
    </section>
  );
}

/** The page's sections, as anchors, so a long LP page is a click from any part of it. */
export function LpSections({ sections }: { sections: Array<{ id: string; label: string }> }) {
  return (
    <nav className={s.sections} aria-label="On this page">
      {sections.map((x) => <a key={x.id} href={`#${x.id}`}>{x.label}</a>)}
    </nav>
  );
}
