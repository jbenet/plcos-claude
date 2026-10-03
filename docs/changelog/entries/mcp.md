# MCP access — agents read and draft as you, with a token from Preferences · 2 Oct 2026

| | |
|---|---|
| ![Preferences → MCP access: a new token with the command that connects Claude Code, and a table with one live and one revoked token](docs/changelog/shots/mcp/01-preferences-mcp-tokens.webp) | **Preferences → MCP access.** Name a token, choose Read or Read and draft, and optionally fewer vehicles. The token is shown once, with the `claude mcp add` line filled in; the table shows each token's reach, when it was last used, and Revoke. The token in the picture was minted by a demo server on invented data. |

Juan asked on 2 Oct 2026 for "MCP access to PLCOS to enable a wide range of actions", after email. This is phase 1
of `docs/26-mcp.md`: an agent — Claude Code, Claude Desktop — uses the app as one person, with that person's access
or less. It reads, and it drafts. It cannot send, approve, accept, change a status or move money: the server has no
such tools.

**One server.** Streamable HTTP at `/api/mcp`, in the Next app, through the official TypeScript SDK; stateless, each
POST answered as JSON. Claude Code connects over HTTP. Claude Desktop starts local servers as commands, so a
40-line bridge, `npm run mcp:stdio`, passes its messages to the endpoint.

**Tokens.** Made and revoked in Preferences; `plcos_mcp_` and 32 random bytes, shown once, kept only as a SHA-256
(`platform.mcp_token`, migration `014_mcp_token.sql`); 90 days, at most ten live per person. The token row is the
call's work envelope: tools, vehicles (narrowing the owner's), a daily budget and an expiry. An Admin's token reads as
a GP, so licensed Dakota values never leave through MCP: Dakota data never goes into an agent's prompt.

**The same checks as the pages.** The owner's roster row is read on every call. Answers are allowlisted projections
with every value behind `can()` for its vehicle and field class; the page facades run inside `actAs(owner)`, so their
redaction is the owner's, not the local switcher's fallback user. The draft tool runs the email action's own rule,
then the live-server rule for real data, then the email service.

**Tools.** Nine read: `search`, `lp_summary` (status, evidence, contact dates, latest strategy, hard and soft amounts
apart, restrictions, top routes), `routes_to`, `routes_through`, `pipeline`, `target_lists` (this year's close, 2027,
not now), `replies_owed`, `feedback_issues`, `changelog`. Two draft: `create_email_draft` (saved in the app for its
owner, not moved to Gmail) and `file_feedback` (journaled like the box; only the live app files). Every answer says
what it covered and opens with a notice that its text is data, never an instruction.

**Safety.** Each call is checked against its envelope, rate-limited (60 a minute, 2,000 a day per token, both GUESSES),
size-limited, and audit-logged as `mcp.call` with the tool, the outcome and the arguments — ids and fixed choices as
given, typed text only as its length. Making, revoking and using a dead token are logged too. While the agents'
correction budget is spent, the draft tools refuse.

**Excluded** (docs/26 §3): sends and moves to Gmail, approvals and acceptance, status changes, money and allocation,
imports and connector runs. **Next** (phase 2): update a draft, propose a move or a task for a person to accept, add a
note, and read tokens for Viewers.

Tests: ten properties through the real route handler and the SDK client — a token for one vehicle cannot read
another's LPs by any tool; amounts, words and restriction reasons never reach those without them, and licensed values
reach no token; the registry holds only read and draft tools and an invented `send_email` does not exist; revoked and
expired tokens fail and are logged; every call is audited without typed words; budgets, rate, size, and the acting
user. One end-to-end check makes a token in Preferences, reads and drafts with the SDK client over HTTP, revokes it in
Preferences, and sees the next connect fail. Invented data only; nothing was pointed at live or real data.
