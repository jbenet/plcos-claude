import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { EnrichmentTable } from '@/components/research/EnrichmentTable';
import { gapsFor, listMethods } from '@/modules/research';

export const dynamic = 'force-dynamic';

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

  return (
    <Page
      crumbs={[
        { label: SECTION.orgs, href: '/orgs/g/all' },
        { label: 'Data enrichment' },
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
      <div className="lbl">Orgs &amp; people · Data enrichment</div>
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

      <EnrichmentTable methods={methods} />

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
