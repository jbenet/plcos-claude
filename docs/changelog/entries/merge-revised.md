# A revised finding takes nothing from the merge · 7 Oct 2026

The merge script (`scripts/enrich-merge-findings.ts`) already left a fact-checked finding alone. It didn't know about a
W1q revision, and put back a fact a revision had dropped on purpose. Any finding a person or a pass corrected after it
was written (the W1c check, a W1 revision, a re-date) now takes nothing by rule; only the script's own earlier merges
don't count. `--redo <raw before the merge>` restores each such file a merge wrote, skips files that merge didn't
touch, and adds a dated note. Property in `scripts/properties/alias-join.ts`.

**Nor does an LP with any revised finding.** A fact check cut a reading on a firm's own finding; an older finding still
carried it, and the merge copied it into a contact's finding that had no correction of its own. A cut lives only in
the words of the finding it was made on, so when any of an LP's findings was revised, the merge now leaves that LP
alone, and `--redo` restores the files a merge wrote for such LPs.
