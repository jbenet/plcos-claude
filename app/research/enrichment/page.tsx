import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import {
  gapsFor, listMethods, METHOD_KIND_LABEL, METHOD_KIND_MEANS, METHOD_STATUS_LABEL,
  type Method, type MethodKind,
} from '@/modules/research';

export const dynamic = 'force-dynamic';

const KIND_ORDER: MethodKind[] = ['ask', 'interview', 'buy', 'integrate', 'query', 'observe', 'infer'];

const TIER_FLAG: Record<string, string> = { A: 'f-ok', B: 'f-ok', C: 'f-ev', D: 'f-mute' };
const STATUS_FLAG: Record<string, string> = {
  available: 'f-ok', in_use: 'f-mute', blocked: 'f-ev', rejected: 'f-block',
};

function money(m: Method): string {
  if (m.costUsd === null) return 'free';
  if (m.costUsd === 0) return 'free';
  return `$${m.costUsd.toLocaleString('en-GB')}`;
}

export default async function Enrichment() {
  const selection = await vehicleSelection();
  const gaps = await gapsFor(selection.current?.id ?? null);
  const methods = await listMethods(gaps);

  const openGaps = gaps.reduce((s, g) => s + g.count, 0);
  const available = methods.filter((m) => m.status === 'available');
  const blocked = methods.filter((m) => m.status === 'blocked');
  const rejected = methods.filter((m) => m.status === 'rejected');
  const inUse = methods.filter((m) => m.status === 'in_use');

  const covered = new Set(methods.flatMap((m) => m.yields));
  const uncovered = gaps.filter((g) => !covered.has(g.code));

  const byKind = KIND_ORDER
    .map((k) => ({ kind: k, rows: methods.filter((m) => m.kind === k) }))
    .filter((g) => g.rows.length > 0);

  return (
    <Page
      crumbs={[
        { label: SECTION.other },
        { label: 'Research corpus', href: '/research' },
        { label: 'Enrichment' },
      ]}
      inspector={
        <>
          <div className="lbl">What is missing</div>
          <div className="ihead">{openGaps} open gaps</div>
          <div className="imeta">
            {selection.current ? selection.current.name : 'every vehicle'} · {gaps.length} distinct fields
          </div>

          <div className="kv"><span>Methods available</span><span>{available.length}</span></div>
          <div className="kv"><span>In use</span><span>{inUse.length}</span></div>
          <div className="kv"><span>Blocked</span><span>{blocked.length}</span></div>
          <div className="kv"><span>Rejected</span><span>{rejected.length}</span></div>
          <div className="kv"><span>Gaps nothing covers</span><span>{uncovered.length}</span></div>

          <div className="scope">
            <div className="lbl">Tier is a ceiling, not a hope</div>
            <p>
              Each method records the best evidence tier it can <i>justify</i>. A scraped follow
              graph is tier D however much of it there is, and recording that is what stops a bulk
              source being mistaken for proof later.
            </p>
          </div>

          <div className="warn" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ color: 'var(--clay)' }}>The line that does not move</div>
            <p>
              Prospect research in a neurotech raise drifts toward inferring health information
              about people or their families. <b>Do not.</b> Record only what a person has publicly
              stated about their own interests, attribute it to the source, and never record
              inferred or third-party health detail.
            </p>
          </div>
        </>
      }
    >
      <div className="lbl">Research corpus · Enrichment</div>
      <h1>How we could find out what we do not know</h1>
      <p className="sublede">
        Half the fit board rests on inferences and guesses, and a ranking built on guesses ranks
        the guesses. This is the option space for fixing that — buy it, attach it, search for it,
        ask somebody, watch something public, or put the question in the first meeting.
      </p>

      {/* ---------- the gaps ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What is missing, across the universe</h2>
          <span className="lbl">derived, never stored · {openGaps} open</span>
        </div>
        {gaps.length === 0 ? (
          <div className="cbody">
            <p className="muted">
              Nothing is graded on a guess and no gate is unanswered. Either the universe is
              unusually well researched, or nobody has assessed enough of it to find out.
            </p>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 230 }}>Field</th>
                <th style={{ width: 92 }}>Kind</th>
                <th style={{ width: 64 }} className="right">Open</th>
                <th style={{ width: 230 }}>Who it is open on</th>
                <th>Why it is a gap</th>
              </tr>
            </thead>
            <tbody>
              {gaps.slice(0, 14).map((g) => (
                <tr key={`${g.kind}:${g.code}`}>
                  <td><b>{g.label}</b></td>
                  <td>
                    <span className={`flag ${g.kind === 'gate' ? 'f-ev' : 'f-mute'}`}>
                      {g.kind === 'gate' ? 'hard gate' : 'dimension'}
                    </span>
                  </td>
                  <td className="right mono">{g.count}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{g.entities.join(', ')}</td>
                  <td className="muted">
                    {g.why}
                    {!covered.has(g.code) && (
                      <div className="flag f-block" style={{ marginTop: 4 }}>
                        no method covers this
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>A guess and an unanswered gate are different failures.</b> The first is a reading we
          should trust less; the second is a question nobody asked. Both are listed, labelled,
          and neither is stored — they are computed from the fit board, so this page cannot
          disagree with it.
        </p>
      </div>

      {/* ---------- the catalogue ---------- */}
      {byKind.map((g) => (
        <div className="card" key={g.kind}>
          <div className="chead">
            <h2>{METHOD_KIND_LABEL[g.kind]}</h2>
            <span className="lbl">{g.rows.length} method{g.rows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="worknote">{METHOD_KIND_MEANS[g.kind]}</div>
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 260 }}>Method</th>
                <th>What it yields, and the line it must not cross</th>
                <th style={{ width: 78 }}>Best tier</th>
                <th style={{ width: 118 }} className="right">Cost</th>
                <th style={{ width: 96 }}>Standing</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((m) => (
                <tr key={m.methodId}>
                  <td>
                    <b>{m.name}</b>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                      {m.detail}
                    </div>
                    <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <span className="flag f-mute">{m.coverage}</span>
                      {m.fills > 0 && (
                        <span className="flag f-ok">closes {m.fills} open gap{m.fills === 1 ? '' : 's'}</span>
                      )}
                      <span className={`cert c-${m.certainty}`}>{m.certainty}</span>
                    </div>
                  </td>
                  <td className="muted">
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
                      {m.yields.map((y) => <span className="lever" key={y}>{y.replace(/_/g, ' ')}</span>)}
                    </div>
                    {m.limits && <div style={{ color: 'var(--ink)' }}>{m.limits}</div>}
                    {m.blockedBy && (
                      <div style={{ color: 'var(--clay)', marginTop: 5 }}>
                        <b style={{ fontWeight: 500 }}>Blocked.</b> {m.blockedBy}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`flag ${TIER_FLAG[m.producesTier] ?? 'f-mute'}`}>
                      {m.producesTier}
                    </span>
                  </td>
                  <td className="right">
                    <div className="mono">{money(m)}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {m.effortDays}d
                      {m.latencyDays !== null ? ` · ${m.latencyDays}d wait` : ''}
                    </div>
                    {m.costBasis && (
                      <div className="muted" style={{ fontSize: 9.5, marginTop: 3, lineHeight: 1.4 }}>
                        {m.costBasis}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`flag ${STATUS_FLAG[m.status]}`}>{METHOD_STATUS_LABEL[m.status]}</span>
                    <div className="mono asof">{shortDate(m.asOf)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p className="cover">
        <b>Why a rejected method is on the page.</b> Bulk people data from LinkedIn is listed and
        marked rejected, with the reason. A method we will not use is worth recording — otherwise
        somebody proposes it again in six months thinking it was an oversight, and the reasoning
        has to be reconstructed from memory.
      </p>
      <p className="cover">
        <b>What this covers:</b> {methods.length} methods and {gaps.length} distinct open fields
        across {selection.current ? selection.current.name : 'every vehicle'}. Gaps are computed
        from the fit board rather than kept here. Each target&rsquo;s own gaps and the methods that
        close them sit on its <Link href={`/${selection.current?.slug ?? 'all'}/strategy`}>strategy page</Link>.
      </p>
    </Page>
  );
}
