# A push no longer fails on a file whose log is one entry · 7 Oct 2026

From about 13:30Z, pushes of the Neurotech sourcing D08 batch failed with a 500 (one file of ten, it turned out), and the server logged
"((intermediate value) ?? []).map is not a function". Before replacing a file, a push compares its date with the
server's copy, read from `researched.corrected` or `made.revised`; a copy whose log was one entry, not a list, threw. 16 strategies on the Mac had such a log, written by a W5 pass.
The date is now read from a list or a single entry, and a log of any other kind dates nothing.
