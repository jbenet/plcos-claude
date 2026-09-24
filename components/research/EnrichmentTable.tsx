'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useUrlParam } from '@/lib/url-state';
import { choose } from '@/app/orgs/enrichment/select';
import {
  DEFAULT_PARAMS, METHOD_KIND_LABEL, METHOD_KIND_MEANS, METHOD_STATUS_LABEL,
  METHOD_VERDICT_LABEL, scoreMethods,
  type Method, type MethodKind, type ScoreParams,
} from '@/modules/research/client';

type SortKey = 'priority' | 'value' | 'cost' | 'name' | 'kind' | 'tier' | 'fills';
const SORT_KEYS: readonly SortKey[] = ['priority', 'value', 'cost', 'name', 'kind', 'tier', 'fills'];
type Only = 'all' | 'runnable' | 'automatable' | 'human' | 'queued';
const ONLY: readonly Only[] = ['all', 'runnable', 'automatable', 'human', 'queued'];

const KINDS: MethodKind[] = ['ask', 'interview', 'buy', 'integrate', 'query', 'observe', 'infer'];

const TIER_FLAG: Record<string, string> = { A: 'f-ok', B: 'f-ok', C: 'f-ev', D: 'f-mute' };
const STATUS_FLAG: Record<string, string> = {
  available: 'f-ok', in_use: 'f-mute', blocked: 'f-ev', rejected: 'f-block',
};
const VERDICT_FLAG: Record<string, string> = {
  do_next: 'f-ok', queued: 'f-ev', hold: 'f-mute', blocked: 'f-ev', rejected: 'f-block',
};

const KNOBS: Array<{
  key: keyof ScoreParams; label: string; min: number; max: number; step: number; unit: string;
  why: string;
}> = [
  { key: 'humanDayCost', label: 'A person-day costs', min: 1, max: 30, step: 1, unit: 'pts',
    why: 'The scarcest thing this team has. Raise it and everything an agent can run moves up.' },
  { key: 'aiHourCost', label: 'An AI hour costs', min: 0, max: 5, step: 0.25, unit: 'pts',
    why: 'Cheap and not free — somebody still reads the output and decides whether to believe it.' },
  { key: 'dollarsPerPoint', label: 'One point is worth', min: 250, max: 10000, step: 250, unit: '$',
    why: 'Puts money and time in the same unit. Lower it and paid databases look expensive.' },
  { key: 'aiBias', label: 'Bias toward agent-run', min: 1, max: 3, step: 0.1, unit: '×',
    why: 'A bet on repeatability rather than on magic: a search an agent can run is worth more than its cost, because it can be run again.' },
  { key: 'humanWip', label: 'Human queue limit', min: 1, max: 15, step: 1, unit: '',
    why: 'How many human-run methods to have in flight. Too many and none of them finish.' },
  { key: 'aiWip', label: 'Agent queue limit', min: 1, max: 40, step: 1, unit: '',
    why: 'Larger, because agents wait rather than work. Still bounded: every run needs reading.' },
];

/**
 * One table, a rule you can move, and a queue.
 *
 * The catalogue used to be seven tables grouped by kind, which made it impossible to answer
 * the only question anybody has: **what should we do next?** Kind is a column now, the
 * ranking is `value ÷ cost` with the weights on the page, and choosing something puts it in
 * a queue with a limit — because the failure mode here is not picking the wrong one, it is
 * starting eleven and finishing none.
 */
export function EnrichmentTable({ methods }: { methods: Method[] }) {
  const [params, setParams] = useState<ScoreParams>(DEFAULT_PARAMS);
  const [showKnobs, setShowKnobs] = useState(false);
  // The view is in the address (issue 0009): which methods, and in what order, so back steps
  // through them and a copied link shows the same table.
  const [kind, setKind] = useUrlParam<MethodKind | 'all'>('kind', 'all', ['all', ...KINDS]);
  const [only, setOnly] = useUrlParam<Only>('show', 'runnable', ONLY);
  const [sort] = useUrlParam<SortKey>('sort', 'priority', SORT_KEYS);
  const [dir, setDir] = useUrlParam<'asc' | 'desc'>('dir', 'desc', ['asc', 'desc']);
  const asc = dir === 'asc';
  const [pending, start] = useTransition();
  /**
   * The checkbox has to answer immediately.
   *
   * `selected` comes from the server and the server action revalidates, so a controlled
   * checkbox snaps back for as long as that round trip takes and reads as a dead control.
   * Local overrides win until the server agrees.
   */
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const withLocal = useMemo(
    () => methods.map((m) => (m.methodId in optimistic
      ? { ...m, selected: optimistic[m.methodId]! } : m)),
    [methods, optimistic],
  );

  const scored = useMemo(() => scoreMethods(withLocal, params), [withLocal, params]);

  const rows = useMemo(() => {
    const keep = scored.filter((m) => {
      if (kind !== 'all' && m.kind !== kind) return false;
      if (only === 'runnable') return m.status === 'available' || m.status === 'in_use';
      if (only === 'automatable') return m.automatable;
      if (only === 'human') return !m.automatable;
      if (only === 'queued') return m.selected;
      return true;
    });
    const dir = asc ? 1 : -1;
    return [...keep].sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name) * -dir;
        case 'kind': return a.kind.localeCompare(b.kind) * -dir;
        case 'tier': return a.producesTier.localeCompare(b.producesTier) * -dir;
        case 'value': return (a.score.value - b.score.value) * dir;
        case 'cost': return (a.score.cost - b.score.cost) * dir;
        case 'fills': return (a.fills - b.fills) * dir;
        default: return (a.score.priority - b.score.priority) * dir;
      }
    });
  }, [scored, kind, only, sort, asc]);

  const queuedHuman = scored.filter((m) => m.selected && !m.automatable).length;
  const queuedAi = scored.filter((m) => m.selected && m.automatable).length;
  const overHuman = queuedHuman > params.humanWip;
  const overAi = queuedAi > params.aiWip;

  const head = (key: SortKey, label: string, cls = '') => (
    <th
      className={`sortable ${cls}${sort === key ? ' on' : ''}`}
      onClick={() => {
        if (sort === key) { setDir(asc ? 'desc' : 'asc'); return; }
        // One history entry for the new order: the key and the direction change together.
        const u = new URL(window.location.href);
        if (key === 'priority') u.searchParams.delete('sort'); else u.searchParams.set('sort', key);
        u.searchParams.delete('dir');
        window.history.pushState(null, '', u.toString());
      }}
      aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="caret" aria-hidden>{sort === key ? (asc ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    <>
      <div className="card">
        <div className="chead">
          <h2>The queue</h2>
          <span className="lbl">
            {queuedHuman}/{params.humanWip} human · {queuedAi}/{params.aiWip} agent
          </span>
        </div>
        <div className="qbar">
          <div className={`qslot human${overHuman ? ' over' : ''}`}>
            <span className="lbl">Human · the slow one</span>
            <b>{queuedHuman} of {params.humanWip}</b>
            <span className="muted">
              {overHuman
                ? 'Over the limit. Starting more is how none of them finish.'
                : 'Person-time. The scarce one.'}
            </span>
          </div>
          <div className={`qslot agent${overAi ? ' over' : ''}`}>
            <span className="lbl">Agent · the fast one</span>
            <b>{queuedAi} of {params.aiWip}</b>
            <span className="muted">
              {overAi
                ? 'Over the limit. Every run still needs reading.'
                : 'Agents wait rather than work, so the limit is larger and still real.'}
            </span>
          </div>
          <button className="btn" onClick={() => setShowKnobs(!showKnobs)}>
            {showKnobs ? 'Hide the weights' : 'Adjust the weights'}
          </button>
        </div>

        {showKnobs && (
          <div className="knobs">
            {KNOBS.map((k) => (
              <label className="knob" key={k.key} title={k.why}>
                <span className="kl">
                  {k.label} <b className="mono">{k.unit === '$' ? '$' : ''}{params[k.key]}{k.unit === '$' ? '' : k.unit}</b>
                </span>
                <input
                  type="range"
                  min={k.min}
                  max={k.max}
                  step={k.step}
                  value={params[k.key]}
                  onChange={(e) => setParams({ ...params, [k.key]: Number(e.target.value) })}
                />
                <span className="kw">{k.why}</span>
              </label>
            ))}
            <div className="knobfoot">
              <button className="btn" onClick={() => setParams(DEFAULT_PARAMS)}>Back to defaults</button>
              <span className="muted">
                Kept in this tab only. Every default is a guess about this team at this moment,
                which is why they are on the page rather than in the code.
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Every way we could find out</h2>
          <span className="lbl">{rows.length} of {methods.length} shown · ranked by priority</span>
        </div>

        <div className="sorter" style={{ padding: '10px 15px 0' }}>
          {(['runnable', 'automatable', 'human', 'queued', 'all'] as const).map((o) => (
            <button key={o} className={only === o ? 'on' : ''} onClick={() => setOnly(o)} aria-pressed={only === o}>
              {o === 'runnable' ? 'Runnable' : o === 'automatable' ? 'Agent runs it'
                : o === 'human' ? 'A person runs it'
                : o === 'queued' ? 'In the queue' : 'Everything'}
            </button>
          ))}
          <span style={{ width: 12 }} />
          <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')} aria-pressed={kind === 'all'}>
            Any kind
          </button>
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}
                    aria-pressed={kind === k} title={METHOD_KIND_MEANS[k]}>
              {METHOD_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {/* Seven columns in a column that is often 820px wide. The scroller is the honest
            answer: every column stays readable and the table moves instead of the numbers
            being squeezed into two characters. */}
        <div className="scroller">
        <table className="list enrich">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              {head('name', 'Method')}
              {head('kind', 'Kind', 'w80')}
              {head('value', 'Value', 'w104 right')}
              {head('cost', 'Cost', 'w144 right')}
              {head('priority', 'Priority', 'w108 right')}
              <th style={{ width: 100 }}>Do it?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              /* Two rows per method: the numbers on one line, and the prose on a line of
                 its own underneath. A sentence in a 150px column is four words a line with
                 a column of white space beside every number. */
              <Fragment key={m.methodId}>
                <tr className={`mnum${m.selected ? ' sel' : ''}`}>
                  <td rowSpan={2}>
                    <input
                      type="checkbox"
                      checked={m.selected}
                      disabled={pending || m.status === 'rejected' || m.status === 'blocked'}
                      aria-label={`Put ${m.name} in the queue`}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setOptimistic((prev) => ({ ...prev, [m.methodId]: on }));
                        start(async () => {
                          await choose(m.methodId, on);
                          setOptimistic((prev) => {
                            const next = { ...prev };
                            delete next[m.methodId];
                            return next;
                          });
                        });
                      }}
                    />
                  </td>
                  <td><b className="mname">{m.name}</b></td>
                  <td><span className="lever">{METHOD_KIND_LABEL[m.kind]}</span></td>
                  <td className="right">
                    <div className="mono num">{m.score.value.toFixed(1)}</div>
                    <div className="sub">{m.fills} gaps · tier {m.producesTier}</div>
                  </td>
                  <td className="right">
                    <div className="mono num">{m.score.cost.toFixed(1)}</div>
                    <div className="sub">
                      ${(m.costUsd ?? 0).toLocaleString('en-GB')} · {m.humanDays}d you · {m.aiHours}h AI
                    </div>
                  </td>
                  <td className="right">
                    <div className="mono num big">{m.score.priority.toFixed(2)}</div>
                    <div className="sub">value ÷ cost{m.automatable ? ` × ${params.aiBias}` : ''}</div>
                  </td>
                  <td>
                    <span className={`flag ${VERDICT_FLAG[m.score.verdict]}`}>
                      {METHOD_VERDICT_LABEL[m.score.verdict]}
                    </span>
                  </td>
                </tr>
                <tr className={`mdetrow${m.selected ? ' sel' : ''}`}>
                  <td colSpan={6}>
                    <div className="mchips">
                      <span className={`flag ${TIER_FLAG[m.producesTier] ?? 'f-mute'}`}>
                        tier {m.producesTier}
                      </span>
                      {/* Both cases get a label. One side labelled and the other silent
                          reads as an oversight rather than as "a person does this". */}
                      {m.automatable
                        ? <span className="lever agent">agent runs it</span>
                        : <span className="lever human">a person runs it</span>}
                      <span className="lever">{m.coverage}</span>
                      <span className={`flag ${STATUS_FLAG[m.status]}`}>{METHOD_STATUS_LABEL[m.status]}</span>
                      <span className={`cert c-${m.certainty}`}>{m.certainty}</span>
                    </div>
                    <div className="muted mdet">{m.detail}</div>
                    {m.costBasis && <div className="mdet dim">{m.costBasis}</div>}
                    {m.limits && <div className="mlimit">{m.limits}</div>}
                    {/* The verdict line below already carries this sentence when the
                        verdict came from it. Printing both reads as two findings. */}
                    {m.blockedBy && m.score.why !== m.blockedBy && (
                      <div className="mblock"><b>Blocked.</b> {m.blockedBy}</div>
                    )}
                    <div className="muted mwhy">
                      <b>{METHOD_VERDICT_LABEL[m.score.verdict]}.</b> {m.score.why}
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>

        <p className="cover">
          <b>Priority is value ÷ cost.</b> Value is how many open gaps it would close, weighted
          by the best evidence tier it can justify — four gaps at tier D is worth less than two
          at tier A, and a number that ignored the tier would put the bulk source first every
          time. Cost puts dollars, your days and model hours in one unit, because <b>time is not
          free and the two kinds of time are not the same</b>. The bias toward agent-run methods
          is a bet on repeatability, and it is a slider rather than a constant.
        </p>
        <p className="cover">
          <b>The queue has a limit because finishing beats starting.</b> Choosing something
          counts against the human or agent limit; past it, everything else reads <i>hold</i>
          with the reason on the row. Nothing is blocked — the counts just stop pretending.
        </p>
      </div>
    </>
  );
}
