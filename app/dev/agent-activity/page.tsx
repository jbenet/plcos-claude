import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const OUTCOMES = ['ok', 'refused', 'rate_limited', 'invalid', 'error'];
const LIMIT = 200; // GUESS — a day of a desk's polling and writes fits; older rows are a page away.

interface Row {
  id: string; at: Date | string; owner: string; token: string; label: string | null;
  detail: { via?: string; client?: string; tool?: string; risk?: string; outcome?: string; reason?: string | null; ms?: number;
    affected?: Record<string, string>; idempotencyKey?: string | null; correlationId?: string | null; inputHash?: string; args?: Record<string, unknown>; scopes?: string[] };
}

/**
 * Developer → Agent activity (docs/26 §4): every MCP and outreach call, one row each, from the audit log — who, which
 * client (the token's name), the tool, the outcome and why, how long, what it touched, and the ids that tie a
 * client's chain of calls together. Filter by client, tool and outcome. An Admin sees everyone's; anyone else
 * their own. To report a problem with a call, open it and use the feedback box: the issue records this page,
 * with the call's id in its address.
 */
async function AgentActivity({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await (await auth()).currentUser();
  const mine = user.access === 'admin' ? null : user.id;
  const client = one(sp.client).slice(0, 80) || null;
  const tool = one(sp.tool).slice(0, 60) || null;
  const outcome = OUTCOMES.includes(one(sp.outcome)) ? one(sp.outcome) : null;
  const call = /^\d{1,18}$/.test(one(sp.call)) ? one(sp.call) : null;
  const db = await getDb();
  const rows = await db.query<Row>(`select a.id::text, a.at, u.name owner, a.subject_id token, t.label, a.detail
      from platform.audit_log a left join platform.app_user u on u.id = a.actor_id
      left join platform.mcp_token t on t.token_id::text = a.subject_id
     where a.action = 'mcp.call' and ($1::uuid is null or a.actor_id = $1) and ($2::text is null or t.label = $2)
       and ($3::text is null or a.detail->>'tool' = $3) and ($4::text is null or a.detail->>'outcome' = $4)
       and ($5::bigint is null or a.id = $5::bigint)
     order by a.at desc, a.id desc limit $6`, [mine, client, tool, outcome, call, LIMIT]);
  const facets = await db.query<{ label: string | null; tool: string | null; n: number }>(`select t.label, a.detail->>'tool' tool, count(*)::int n
      from platform.audit_log a left join platform.mcp_token t on t.token_id::text = a.subject_id
     where a.action = 'mcp.call' and ($1::uuid is null or a.actor_id = $1) and a.at > now() - interval '30 days'
     group by 1, 2 order by n desc limit 200`, [mine]);
  const clients = [...new Set(facets.map((f) => f.label).filter((x): x is string => Boolean(x)))];
  const tools = [...new Set(facets.map((f) => f.tool).filter((x): x is string => Boolean(x)))].sort();
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const cur: Record<string, string | null> = { client, tool, outcome, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) q.set(k, v);
    const s = q.toString();
    return `/developer/agent-activity${s ? `?${s}` : ''}`;
  };
  const when = (d: Date | string) => formatDate(new Date(d), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const focus = call ? rows[0] ?? null : null;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Agent activity' }]}
      inspector={
        <>
          <div className="lbl">Every call, kept</div>
          <div className="ihead">MCP and the outreach API</div>
          <div className="imeta">{mine ? 'Your calls' : 'Everyone’s calls'} · the last {LIMIT} that match</div>
          <div className="lbl" style={{ marginTop: 14 }}>Client</div>
          <div><Link href={href({ client: null })}>{client ? 'any' : <b>any</b>}</Link></div>
          {clients.map((c) => <div key={c}><Link href={href({ client: c })}>{c === client ? <b>{c}</b> : c}</Link></div>)}
          <div className="lbl" style={{ marginTop: 14 }}>Outcome</div>
          {[null, ...OUTCOMES].map((o) => <div key={o ?? 'any'}><Link href={href({ outcome: o })}>{o === outcome ? <b>{o ?? 'any'}</b> : o ?? 'any'}</Link></div>)}
          <div className="note">
            One audit record per call (`mcp.call`), whether it came over MCP or the REST wrapper: arguments as ids and
            lengths and a hash, never words. Refusals are kept like the rest. Nothing is deleted; retention is
            everything, for now.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Agent activity</h1>
      <p className="sublede">
        What agents and clients did with their tokens — juanmail, Claude Code, a device — and how it went.
        {' '}Tool: {tools.length ? tools.map((t, i) => (
          <span key={t}>{i ? ' · ' : ''}<Link href={href({ tool: t === tool ? null : t })}>{t === tool ? <b>{t}</b> : t}</Link></span>
        )) : 'none yet'}
      </p>

      {focus && (
        <div className="card" data-call={focus.id}>
          <div className="chead"><h2>Call {focus.id}</h2><span className="lbl">{when(focus.at)}</span></div>
          <div className="cbody">
            <p style={{ marginTop: 0 }}>
              <b>{focus.detail.tool}</b> by {focus.owner} through <b>{focus.label ?? focus.detail.client ?? 'a token'}</b> ({focus.detail.via ?? 'mcp'}):
              {' '}{focus.detail.outcome}{focus.detail.reason ? ` — ${focus.detail.reason}` : ''} · {focus.detail.ms ?? '?'} ms
            </p>
            <dl className="kvs">
              <dt>Affected</dt><dd className="mono">{Object.entries(focus.detail.affected ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing named'}</dd>
              <dt>Arguments</dt><dd className="mono">{JSON.stringify(focus.detail.args ?? {})}</dd>
              <dt>Input hash</dt><dd className="mono">{focus.detail.inputHash ?? '—'}</dd>
              <dt>Idempotency key</dt><dd className="mono">{focus.detail.idempotencyKey ?? '—'}</dd>
              <dt>Correlation id</dt><dd className="mono">{focus.detail.correlationId ? <Link href={href({ tool: null })}>{focus.detail.correlationId}</Link> : '—'}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Something wrong with this call? Use the feedback box on this page: the issue records this address, call {focus.id} included.
              An agent can do the same with file_feedback and the callId.
            </p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="chead"><h2>Calls</h2><span className="lbl">{rows.length} shown · newest first</span></div>
        <table className="list">
          <thead><tr><th>When</th><th>Client</th><th>Tool</th><th>Outcome</th><th className="right">ms</th><th>Affected</th><th>Correlation</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-outcome={r.detail.outcome}>
                <td className="mono"><Link href={href({ call: r.id })}>{when(r.at)}</Link></td>
                <td>{r.label ?? r.detail.client ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{r.owner} · {r.detail.via ?? 'mcp'}</div></td>
                <td className="mono">{r.detail.tool}</td>
                <td><span className={`flag ${r.detail.outcome === 'ok' ? 'f-ok' : r.detail.outcome === 'error' ? 'f-block' : 'f-mute'}`}>{r.detail.outcome}</span>
                  {r.detail.reason && <div className="muted" style={{ fontSize: 11 }}>{r.detail.reason.slice(0, 120)}</div>}</td>
                <td className="right mono">{r.detail.ms ?? ''}</td>
                <td className="mono" style={{ fontSize: 11 }}>{Object.keys(r.detail.affected ?? {}).join(', ') || ''}</td>
                <td className="mono" style={{ fontSize: 11 }}>{r.detail.correlationId ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="cover">No calls match. A token’s calls appear here as soon as it is used.</p>}
      </div>
    </Page>
  );
}

export default coalescePage('/dev/agent-activity', AgentActivity);
