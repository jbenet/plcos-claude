# A refresh adds to an LP's older finding · 7 Oct 2026

The 30 Sep–7 Oct W1 refreshes were written under canonical keys beside the older alias findings, and the newest
finding is the one W5 and the checker read. They replaced rather than added: in 6 of 10 LPs in one Neurotech batch,
the only evidence of the LP's own money (angel checks, investing bios, holdings) was in the older file, so the writers
saw an operator with capacity unknown and had to carry the dropped facts by hand. The app was not affected, since the
import keeps claims from every finding file.

`scripts/enrich-merge-findings.ts` merges each LP's older findings into its newest: each fact and connection the
newest lacks is added with its own source, recorded as a dated correction, and the profile is left for W5 to read
against them. An older finding joins only by key or alias, never by name, and only as a confirmed or probable match.
W1 now reads an LP's existing finding first and carries its facts forward.
