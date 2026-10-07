# An intake rule's provenance note stales nothing · 7 Oct 2026

When the prospects intake or the investing-organizations rule creates a pursuit, it also writes a context note saying
where the LP came from. Team context newer than a strategy makes it stale, so these notes, written about 1.5 hours
after the strategies that had read the same prospect lines, staled them while carrying nothing to act on. In one
Neurotech sourcing batch, every key was stale for this reason alone.

The research export now marks such notes (`byRule`, from a `rule` in the note's data or `source: prospects`), and
neither the checker, the batch cutter nor the vehicle page counts them toward staleness. Writers still see the text.
A person's context is unchanged: it stales the strategies it bears on.
