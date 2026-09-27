# Portfolio tables and quieter navigation — issues 0079, 0080, 0081

Vehicle portfolios now show companies, founders and sourced investment tables. Dates retain their source precision; missing multiples remain unreported. Detailed provenance and identity evidence sit behind disclosures. Historical fund attribution stays visible, warehouse classifications are not presented as confirmed fund holdings, and SPV research appears under its own vehicle.

The import treats its input as an authoritative snapshot, honors exclusions, and removes obsolete membership evidence while preserving independent graph evidence. Sourced domains, profile URLs and warehouse identifiers can corroborate founder identities; names alone remain possible matches. Investment values stay in the private data file, with a source on every row. A new append-only migration stores investment disclosures and classification.

Feedback shortcut hints appear only while the keyboard shortcut overlay is open, using Option+F on Apple devices and Alt+F elsewhere. The rail’s WIP group drops the redundant incomplete label.

Validation: typecheck, boundary checks and all 441 repository properties pass, along with eight focused portfolio properties and 17 existing route/portfolio properties. Demo HTML checks cover investment and missing-data states, Rails classification, shortcut visibility rules, accessible table headers and responsive styles. No browser was available for visual or keyboard interaction checks. Page timing and importer regression results are recorded in the private handoff report. No screenshots or private names or investment figures are included here.
