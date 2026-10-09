# What the mail says · 9 Oct 2026

Juan asked for actions on the mail his new mail client (juanmail) reads: status from the conversation, what we learn about
LPs and connectors, strategy from the threads, and people's latest contact details (docs/29).

- **Signals.** juanmail reports, per message, short readings about each person in it by their role in that thread (LP,
  connector, other): interest, a soft commitment or an amount, a question, an objection, a decline, timing, a request,
  a referral, an intro offer. `outreach_record_signals` keeps them beside the LP and answers suggestions — a status
  forward, an indicated amount, a next step — as ready updates for Juan to accept. Nothing changes until he does.
- **A reply in Gmail counts.** A reply from the LP that juanmail reports now records "LP opted in" through Reconciliation,
  as one from Affinity does; being copied on someone else's message does not.
- **Contact details.** A phone, title, firm, postal address or LinkedIn page read from a sender's signature is kept as an
  unconfirmed, dated claim; the newest reading wins, other sources' values stay. `outreach_contacts?details=1` returns them.
- **Strategy.** `outreach_insights` sums a vehicle's readings by kind and topic — what LPs keep asking and objecting to —
  and the W5 strategy pass reads each LP's.
- **The playbook** juanmail runs is docs/workflows/mail-actions.md, also returned by `outreach_playbook`.
