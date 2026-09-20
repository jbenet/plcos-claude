import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { shortDate } from '@/lib/time';
import { ANSWER_STATUS_LABEL, coverageGaps, listAnswers } from '@/modules/library';

export const dynamic = 'force-dynamic';

const STATUS_FLAG: Record<string, string> = {
  approved: 'f-ok', draft: 'f-mute', needs_review: 'f-block',
  superseded: 'f-mute', withdrawn: 'f-mute',
};

export default async function Library() {
  const [answers, gaps] = await Promise.all([listAnswers(), coverageGaps()]);
  const approved = answers.filter((a) => a.status === 'approved');
  const stale = answers.filter((a) => a.stale);
  const uncovered = gaps.filter((g) => !g.nearest);

  return (
    <Page
      crumbs={[{ label: 'Create & substantiate' }, { label: 'Evidence & answer library' }]}
      inspector={
        <>
          <div className="lbl">Why answers have their own approval</div>
          <div className="ihead">Separate from the documents they cite</div>
          <div className="imeta">Because a source can change while the answer stays approved</div>
          <div className="kv">
            <span>Answers</span>
            <span>{answers.length}</span>
          </div>
          <div className="kv">
            <span>Approved</span>
            <span>{approved.length}</span>
          </div>
          <div className="kv">
            <span>Stale</span>
            <span style={{ color: stale.length ? 'var(--clay)' : undefined }}>{stale.length}</span>
          </div>
          <div className="kv">
            <span>Questions with no answer</span>
            <span style={{ color: uncovered.length ? 'var(--clay)' : undefined }}>{uncovered.length}</span>
          </div>
          <div className="scope">
            <div className="lbl">Two ways to go stale</div>
            <p>
              On a date, and on a fact. Both are recorded: an answer carries an expiry, and it
              also carries the claims it rests on — so superseding a claim flags the answer even
              though nobody touched it.
            </p>
          </div>
          <div className="note">
            The gap list below is module 13&rsquo;s backlog generator. It is a query over what
            people have actually been asked, not a content plan somebody wrote in advance.
          </div>
        </>
      }
    >
      <div className="lbl">Modules 17 and 13 · Create &amp; substantiate</div>
      <h1>Evidence &amp; answer library</h1>
      <p className="sublede">
        The answers we have agreed to give, each with its own version and approval state — kept
        separate from the source documents, because a document can change while the answer sits
        there still marked approved.
      </p>

      {uncovered.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Questions with nothing approved behind them</h2>
            <span className="lbl">module 13 · the backlog, generated rather than planned</span>
          </div>
          {uncovered.map((g) => (
            <div className="row" key={g.question} style={{ alignItems: 'flex-start' }}>
              <span className={`kind ${g.kind === 'objection' ? 'k-stage' : 'k-chore'}`} style={{ width: 96 }}>
                {g.kind}
              </span>
              <div className="t">
                <b style={{ fontWeight: 400, lineHeight: 1.5 }}>{g.question}</b>
                <span>Raised by {g.entities.join(', ')}</span>
              </div>
              <div className="state">
                <b>
                  {g.occurrences}×
                </b>
                no approved answer
              </div>
            </div>
          ))}
          <p className="cover">
            <b>This is the content backlog.</b> Not a calendar of things somebody would like to
            write — a list of questions people have actually been asked, with nothing approved to
            answer them with. When the same one appears against three targets, that is the next
            thing to write.
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>The library</h2>
          <span className="lbl">
            {approved.length} approved · {stale.length} stale
          </span>
        </div>
        {answers.map((a) => (
          <div className="row" key={a.answerId} style={{ alignItems: 'flex-start' }}>
            <div className="t">
              <b>{a.question}</b>
              <span style={{ display: 'block', lineHeight: 1.6, marginTop: 4 }}>{a.answer}</span>

              {a.sources.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span className="lbl" style={{ marginRight: 8 }}>
                    Rests on
                  </span>
                  {a.sources.map((s, i) => (
                    <span key={i} className="flag f-mute" style={{ marginRight: 4 }}>
                      {s.label}
                    </span>
                  ))}
                </div>
              )}

              {a.stale && (
                <div className="warn" style={{ marginTop: 10 }}>
                  <div className="lbl" style={{ color: 'var(--clay)' }}>
                    Stale
                  </div>
                  <p>{a.staleReason}</p>
                </div>
              )}

              {a.uses.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
                  Used {a.uses.length}×: {a.uses.map((u) => `${u.context} (${shortDate(u.usedOn)})`).join(' · ')}
                </div>
              )}
            </div>
            <div className="state" style={{ width: 150 }}>
              <span className={`flag ${STATUS_FLAG[a.status]}`} style={{ marginBottom: 5, display: 'inline-block' }}>
                {ANSWER_STATUS_LABEL[a.status]}
              </span>
              <div>v{a.version}</div>
              {a.approvedByName && (
                <div>
                  {a.approvedByName}
                  {a.approvedOn ? ` · ${shortDate(a.approvedOn)}` : ''}
                </div>
              )}
              {a.expiresOn && <div>expires {shortDate(a.expiresOn)}</div>}
            </div>
          </div>
        ))}
        <p className="cover">
          <b>An answer is approved separately from what it cites.</b> The PRI answer was approved
          in March 2024 and rests on a source note from the same month — it is flagged because the
          date passed, and it would also be flagged if the claim underneath it were superseded.
          Nobody has to notice.
        </p>
      </div>

      {gaps.filter((g) => g.nearest).length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Questions the library already covers</h2>
            <span className="lbl">matched loosely, so check before reusing</span>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>Asked</th>
                <th style={{ width: 90 }}>Kind</th>
                <th style={{ width: 340 }}>Nearest answer</th>
                <th style={{ width: 120 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {gaps
                .filter((g) => g.nearest)
                .map((g) => (
                  <tr key={g.question}>
                    <td>
                      <b>{g.question}</b>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {g.entities.join(', ')}
                      </div>
                    </td>
                    <td className="muted">{g.kind}</td>
                    <td className="muted">{g.nearest!.question}</td>
                    <td>
                      <span className={`flag ${STATUS_FLAG[g.nearest!.status]}`}>
                        {ANSWER_STATUS_LABEL[g.nearest!.status]}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="cover">
            The match is a word-overlap heuristic and it is <b>not</b> an assertion that the answer
            fits. It is a pointer to check, which is why the column says &ldquo;nearest&rdquo;
            rather than &ldquo;answer&rdquo;. <Link href="/decisions">The decision room</Link> is
            where the actual answer gets attached to the actual objection.
          </p>
        </div>
      )}
    </Page>
  );
}
