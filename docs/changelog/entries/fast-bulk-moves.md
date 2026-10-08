# Bulk moves in a fixed handful of statements · 8 Oct 2026

Issues 0139 and 0140. On an SPV's selection page, moving 11 LPs to Selected took about ten seconds, and a move
of two ran past the page's 12-second wait, so the page reported it as not confirmed. A move made about nine
statements per row (reading the pursuit and its ladder twice, the update, the status, two audit rows, recording
what it applied). The live database is a remote Postgres, so each statement was a network round trip.

A bulk change (a move, Set status, a touchpoint, a note or a workflow request) and its Undo now lock the rows,
read them, and write the updates, statuses and audit rows in about ten statements, whatever the row count. On
the demo database an 11-row move went from 91 statements to 10. The audit rows, updates and refusals are the
same as before. `setStatuses` in `modules/strategy` writes many statuses the way `setStatus` writes one, and it
leaves the next step as it is, as a bulk move always did.

A retry can't apply a move twice. A retry with the same key writes nothing. A retry with a new key, after the page
gave up waiting, waits on the row locks the first request holds. It then sees the statuses that request wrote and
refuses with "is Selected now … Nothing in this batch was changed."

A new property checks that a three-row move makes as many statements as a one-row move.
