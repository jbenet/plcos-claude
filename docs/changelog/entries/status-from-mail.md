# Status moves with the mail

Juan, 9 Oct 2026, chose "Auto, with undo", and kept it beside a status picker in Raise ("Both"). Reconciliation now
moves an LP's status forward on the records on file (docs/29 §4a):

- **Our email** moves an LP from New, Sourcing or Selected to **Connecting**.
- **Their reply, or a meeting or call with them**, moves them to **Discussing**. Our events, a firm's records and
  auto-replies do not count.
- **Never to Committed or Passed**, never backward, and only on records from 9 Oct 2026 on, so no LP moves on its history.
- **Undo** by setting the status back: Reconciliation does not move it again until something new happens. The status
  says it was Reconciliation and why ("Reconciliation: a reply from them, 9 Oct").

It runs on every Reconciliation pass, so at once after juanmail reports a reply. `config.reconcile.statusFromRecordsSince`
set to null turns it off.
