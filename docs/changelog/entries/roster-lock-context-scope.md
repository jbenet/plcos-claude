# Pushes no longer wait on the network rebuild; strategies go stale only for context and corrections that bear on them · 7 Oct 2026

**The roster lock.** After the audit-lock fix, a push sent while a findings import was "Rebuilding research ties" still
failed at its record stage with 57014. The rebuild syncs the team roster inside its one long transaction, and that read
each active account `for update`. A row lock of that strength conflicts with the key-share lock a foreign-key check
takes, so every insert naming a team member (a push's `platform.sync_push` row, an audit row with an actor) waited until
the rebuild committed, then hit the 20 s statement timeout. The roster now reads with `for no key update`, which still
serializes roster writers but lets foreign-key checks through. A new Postgres property runs the roster sync in an open
transaction and inserts an audit row naming the account from another connection under a 2 s lock timeout.

**Context scoped to its vehicle.** A team note added from one vehicle's pursuit (the 7 Oct SPV - Science lines) made
every vehicle's W5 strategy for that LP stale, which put most of the Neurotech rewrite queue in place for nothing.
Candidates now carry the note's vehicle slug, and `contextAtFor` picks the newest note about the LP as a whole or from
the strategy's own vehicle. The batcher, the checker and the vehicle page's "stale" flag use it. A note with no vehicle,
or a strategy whose vehicle can't be resolved, still counts every note.

**Corrections scoped by what they did.** Of 2,466 correction entries on the Mac's 3,700 findings, 1,209 were
append-only SPV appetite passes (1,004 of them adding no fact) and 321 appended connector evidence; each one marked
every strategy for the LP stale. `correctionReach` reads a correction's `by` and `what`: the W1c fact check, and
anything it can't place, still stales every strategy; an append-only SPV pass that added facts stales only SPV
strategies (or one whose vehicle is unknown); an SPV pass with no new fact, or appended ties, stales none, since W3's
paths are already pinned through the best tier. The research export's `vehicles.json` now carries each vehicle's kind.
