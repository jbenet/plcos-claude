# A strategy stamped later than it was written is counted · 7 Oct 2026

A W5 writer stamped a lead's `made.at` about 45 minutes after the file was written. A future `made.at` hides
staleness (a newer finding looks older than the strategy) and moves the pins of the firm-level files that follow the
lead. The checker now counts "N stamped later than they were written", later than now or than the file's last write
with ten minutes' leeway, and lists them with `--future-made <file>`. It is a count, not a refusal.
