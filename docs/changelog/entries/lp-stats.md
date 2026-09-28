## LP stats — who the LPs are, counted, with every count a filter

| | |
|---|---|
| ![LP stats for PLC Neurotech I: the summary counts and the panel grid](docs/changelog/shots/lp-stats/01-stats-panels.webp) | `/neurotech/stats`: the header counts, then the fifteen panels — LP type, typical check size, region, country, score, fit, status, owner, last touch, best path, source, strategy, research, LP unit and vehicle — each a list of bars with count and share. |

Juan, 27 Sep: *"we should gather some stats about LPs: counts of what types of them are there (refer to
prior reports for good segmentation), counts per typical check size, counts for score bands, counts for
country… We should add a page like 'LP stats' to each vehicle (and all)… That page should also allow
filtering and search to narrow the set displayed in stats."*

**Where.** `/<vehicle>/stats` for one vehicle and `/all/stats` for every vehicle being raised (`/stats`
redirects there, keeping its filters). In the rail it sits under Funder–vehicle fit.

**What is counted.** LP units (docs/23): an organisation, or a person in their own capacity. On a vehicle
that is one pursuit each. Across vehicles an LP counts once, with the status, owner, score and fit of its
furthest-along pursuit; its best path is the best across them. Fifteen panels, each a list of bars with
count and share:

| Panel | From |
| --- | --- |
| LP type | Report 1 §2.2 and Report 4 §2.1: family office, multi-family office, individual, fund of funds/OCIO/consultant, fund manager, foundation, endowment, corporate/strategic, RIA/wealth/private bank, pension/insurance, sovereign/government, crypto treasury/DAO, other institution, type not known. Read from our record's entity type, then Dakota's account type, the research profile's investorType, the investorType of the organisation's people, and last the name (weakest, labelled; "Capital" alone says nothing). Each panel says how many rest on which. |
| Typical check size | Under $100K · $100–250K · $250K–1M · $1–5M · $5M+ · open range only · not known. The strategy or research capacity band (by midpoint), then Dakota's ticket size, Affinity's check-size field, a prospect list's band (marked a guess). All estimates; an open-ended band such as "<$250K" is not narrowed. |
| Region, Country | Dakota's billing (or a person's mailing) country, else the research profile's location or a sourced location claim, read by `lib/lp-stats/geo.ts`. Regions: North America, Europe, Middle East, Asia (Singapore, Hong Kong, Japan, China, India, elsewhere), Latin America, elsewhere. Affinity's location field is not imported, so it is not used. |
| Selection score, Fit reading | Selection's score (fit assessment, else provisional) in bands; the fit page's groups. |
| Pipeline status, Owner, Last touch | The Selection rows. |
| Best path | The best evidence tier among the routes the last stored search recorded; "none found" and "not searched yet" kept apart (rule 7). |
| Source | Where the pursuit came from: Affinity, Dakota, research prospect lists, the PL network (a prospect keyed from the warehouse), added here, another rule. No record names an intake spreadsheet, so none is counted. |
| Strategy, Research, LP unit, Vehicle | A proposed or accepted strategy; a W1 profile or claims; organisation or individual; the vehicles (the one multi-valued panel: an LP on two counts on each). |

SPV stance is not on master yet, so it has no panel.

**Filtering.** A search box, a Filters picker with every value of every panel (and the vehicle, across
vehicles), and the counts themselves: pressing a bar adds that segment, pressing again takes it off, and
the page keeps its scroll position. Within a panel the choices are OR, across panels AND. Each panel counts
the LPs matching the search and every *other* filter, so a choice can be widened from the same panel; its
bars add up to its own base, which it names. The filters in use show as removable chips, the header shows N
of the total, and the address holds everything, so a view can be sent. The LPs that match are listed below
(50 a page, by score, name or last touch), each linking to its LP page.

**Money.** Hard and soft stay two columns and two figures, never a sum (rule 1). They are shown only when one
vehicle is in view; across vehicles the page says to pick one, because nothing is added across vehicles.

**Coverage.** For region and LP type, our share of the LPs in view beside a reference distribution's share,
with the gap in points ("12 pts over", "in line" under 3). The reference is `config/lp-market-reference.json`,
labelled with its source and date; its values are **invented placeholders** until a research run replaces
them, and the panel says so. Fewer than 20 LPs with a known segment (a guess) mutes the gaps as too few to
mean much; none known shows no table at all.

**Speed.** The facts are gathered once per data generation (lib/build-cache) in set-based reads beside the
Selection rows it already caches; counting is in memory, 2.6 ms for 2,000 invented LPs with two filters.
On a production build of the demo a warm page takes 13–20 ms. Not yet timed on the real data's volume.

**Checked** on the demo at 1440×900 and at 1180×820 with touch (tapping a count, the picker and Apply, an
LP link), and at 390 px. Properties: counts add up to N per panel with no filter and to each panel's base
under 40 random filter sets; filters compose (AND across, OR within, a second press removes, the address
round-trips); an LP counts once across vehicles; hard and soft stay separate (inflating soft moves no hard
figure) and money shows only for one vehicle; the type, band and place readings; the seeded database's
hard and soft per vehicle equal its exposures, track by track.

Files: `lib/lp-stats/{model,data,geo,reference}.ts`, `app/[vehicle]/stats/`, `app/stats/page.tsx`,
`config/lp-market-reference.json`, `lib/nav.ts`, `lib/paths.ts`, `scripts/properties/lp-stats.ts`.
