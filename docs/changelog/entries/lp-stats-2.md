## LP stats 2 — public reference figures, an SPV panel, and better places

Follow-up to [LP stats](lp-stats.md), 27 Sep.

| | |
|---|---|
| ![LP stats with the SPV panel and the Coverage against public figures panel](docs/changelog/shots/lp-stats-2/01-stats-spv-coverage.webp) | The SPVs panel (does ≥N bands, doesn't, unknown) and Coverage against public figures, with its basis switch and source/date/confidence. |

**Public figures replace the placeholder.** `config/lp-market-reference.json` now holds the public figures a
research run compiled (placeholder false), as a list of *bases*. Each basis says what it counts, its source link,
date and confidence:

- **Region:** single-family offices by number, worldwide, 2024 (Deloitte Private), the default. It is a
  distribution by the source's regions, so Asia-Pacific (with Australia and New Zealand), South America and Africa
  are groups of our regions and countries (`groups` in the file).
- **Type:** capital raised by European venture funds in 2024 by LP type (Invest Europe), the default. Government
  and sovereign funds are one row, pensions and insurers one, endowments, foundations and academic institutions one,
  and single- and multi-family offices one.
- **Single figures, not distributions:** Singapore's family offices with tax incentives (MAS), Hong Kong's family
  offices (InvestHK), private AI investment by country (Stanford AI Index), the share of European VC raised from
  Asia and Australia, and government LPs in US venture funds (ECB). Each shows beside our own matching count, with
  no share or gap.

The Coverage panel ("Coverage against public figures") has a switch per side between its bases, kept in the
address (`cr`, `ct`). It shows what the chosen basis counts and its source. It puts LPs that fall in none of a
basis's segments on a row of their own with no gap. It says plainly that different bases count different things —
family offices by number, venture fundraising by capital, one region's funds or the world's — so a gap is a
question, not a finding.

**SPVs.** A panel and a filter from the SPV stance now on master (`modules/strategy/spv-rules.ts`), read through
the Selection rows: does SPVs with ≥10, 5–9, 2–4 or 1 known deals, does with the count not known, doesn't, and
unknown (likely open). Counts are lower bounds. The LP list has an SPVs column.

**Readings, after a look at the real volume.** On the live data (3,428 LPs across vehicles), only 15% had a
country, and 388 organisations were typed from a contact's research profile.

- **Places** (`lib/lp-stats/geo.ts`): cities and forms for Singapore, Hong Kong, Japan, Korea, the UAE, Saudi Arabia
  and the Gulf, China and India, in Latin script and in Chinese, Japanese and Korean. Also more European and US
  cities, and ISO country codes after a comma ("Zurich, CH"). A two-letter code that is also a US state still reads
  as the state unless a place before it names another country, so "Frankfurt, DE" is Germany, not Delaware.
- **Country fallback:** a person with no place of their own takes their firm's, and a firm with none takes the most
  common place among its current people. The list labels which ("their firm's", "their people's").
- **Type from contacts:** only people who speak for the firm count — its contacts on a pursuit, or people whose
  primary affiliation it is, not as a board member, adviser or investor. A family-office principal on a company's
  board no longer makes the company a family office.

Checked on the demo at 1440×900. Properties added: places in Asia and the Gulf and the two-letter rule; SPV bands
and the panel adding up to N; the reference file reads, each distribution sums to 100%, every known LP lands in
exactly one row, and single figures are never compared. The effect of the new readers on the real data is measured
after merge, on the live page.
