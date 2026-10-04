import { headers } from 'next/headers';
import { revokeMcpTokenAction } from '@/app/settings/actions';
import { auth } from '@/lib/auth';
import { can } from '@/lib/authz';
import { READ_TOOLS, TOOLS } from '@/lib/mcp/tools';
import { shortDate, ago } from '@/lib/time';
import { listMcpTokens, listVehicles } from '@/modules/platform';
import { config } from '@/config/deployment';
import { OUTREACH_READ, OUTREACH_WRITE } from '@/lib/outreach/scopes';
import { McpTokenForm } from './McpTokenForm';
import s from './mcp.module.css';

/**
 * Preferences → MCP access (docs/26-mcp.md): make a token for an agent (Claude Code, Claude Desktop),
 * see which ones exist and when each was last used, and revoke any of them. The token acts as you,
 * with your access or less; its tools read and draft, and none sends, approves or moves money.
 */
export async function McpTokens() {
  const user = await (await auth()).currentUser();
  const h = await headers();
  const endpoint = `http://${h.get('host') ?? 'localhost:3000'}/api/mcp`;
  const [tokens, vehicles] = await Promise.all([listMcpTokens(user.id), listVehicles()]);
  const mine = vehicles.filter((v) => v.phase !== 'historical' && can(user, 'read', { vehicle: v.id }));
  const vname = new Map(vehicles.map((v) => [v.id, v.name]));
  const now = Date.now();
  const drafts = TOOLS.filter((t) => t.policy.risk === 'propose' && !t.policy.scopes.length).map((t) => t.title.toLowerCase());
  return (
    <div className="card" id="mcp">
      <div className="chead">
        <h2>MCP access</h2>
        <span className="lbl">for Claude and other agents · reads and drafts only</span>
      </div>
      <div className="cbody">
        <p style={{ marginTop: 0 }}>
          A token lets an agent — Claude Code, Claude Desktop — use this app as you, with your access or less. It can
          read {READ_TOOLS.length} things (search, an LP&rsquo;s summary, routes, the pipeline, target lists, replies owed, issues,
          the changelog) and, if you allow it, {drafts.join(' and ')}. It cannot send an email, approve or accept anything,
          change a status or move money: those tools do not exist on the server. Every call is logged with the tool and the token.
        </p>
        {user.access === 'viewer' ? (
          <p className="muted">Viewers do not make tokens yet.</p>
        ) : (
          <McpTokenForm endpoint={endpoint} vehicles={mine.map((v) => ({ id: v.id, name: v.name }))} draftTools={drafts}
            outreach={user.access === 'admin' && config.outreach.enabled} days={config.mcp.tokenDays} />
        )}
        {tokens.length > 0 && (
          <table className={s.tokens}>
            <thead>
              <tr><th>Token</th><th>May</th><th>Vehicles</th><th>Made</th><th>Last used</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const state = t.revokedAt ? 'revoked' : new Date(t.expiresAt).getTime() <= now ? 'expired' : 'live';
                return (
                  <tr key={t.tokenId} data-state={state}>
                    <td><b>{t.label}</b><br /><span className="mono muted" style={{ fontSize: 11 }}>{t.prefix}…</span></td>
                    <td>{t.tools.includes(OUTREACH_WRITE) ? 'Outreach desk: read and write' : t.tools.includes(OUTREACH_READ) ? 'Outreach desk: read'
                      : t.tools.some((x) => !READ_TOOLS.includes(x)) ? 'Read and draft' : 'Read'}</td>
                    <td>{t.vehicles ? t.vehicles.map((v) => vname.get(v) ?? 'unknown').join(', ') : 'All of yours'}</td>
                    <td>{shortDate(new Date(t.createdAt))}</td>
                    <td>{t.lastUsedAt ? ago(new Date(t.lastUsedAt)) : 'never'}
                      {t.lastUsedFrom && <><br /><span className="muted" style={{ fontSize: 11 }} title={t.lastUsedFrom}>from {t.lastUsedFrom.slice(0, 40)}{t.lastUsedFrom.length > 40 ? '…' : ''}</span></>}</td>
                    <td>
                      <span className={s.state} data-state={state}>
                        {state === 'live' ? `live until ${shortDate(new Date(t.expiresAt))}` : state === 'revoked' ? `revoked ${shortDate(new Date(t.revokedAt!))}` : 'expired'}
                      </span>
                    </td>
                    <td>
                      {state === 'live' && (
                        <form action={revokeMcpTokenAction}>
                          <input type="hidden" name="tokenId" value={t.tokenId} />
                          <button className="btn" type="submit">Revoke</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
          The endpoint is <span className="mono">{endpoint}</span>. A revoked token fails on its next call. Only a hash of
          each token is kept here, so a lost one cannot be shown again: revoke it and make another.
        </p>
      </div>
    </div>
  );
}
