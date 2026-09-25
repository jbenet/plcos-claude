# Findings: LP size → typical commitment, by kind (public market data)

Desk research only. No LP, no record, nothing from `data/` was opened. Web budget used: 40
requests (searches and fetches together) — the full allowance. Two PDF fetches (a Morgan
Lewis fund-formation deskbook page and a 2017 Preqin special report) returned undecodable
binary content and are not cited below; everything cited was actually read, as a page
extract (WebFetch) or a search-engine summary (WebSearch) — the "what I read" column in
Part 3 says which, and Part 2's source keys should be read with that distinction in mind.

## Review (Claude, 25 Sep 2026): no change to the table on this evidence

A Sonnet agent did the research below, working from the brief with 40 web requests. Its report is
careful about what it did not find. What it did find does not justify changing `config.capacity.bySize`.

**Worth keeping**
- **Institutions back first-time managers through programmes.** Public pensions, sovereign funds,
  large endowments and insurers mostly reach first-time managers through a dedicated
  emerging-manager programme or a fund of funds. So for those LPs a strategy should name the route
  (the programme, or the fund of funds that runs it), not a capacity band.
- **The ceiling.** An LP rarely wants to be more than 10–25% of one fund. For a $50–150M fund that
  caps a typical commitment at the table's top band, `$5–25M`, which the table already does.
- **The source list,** for a deeper read.

**Not adopted**
- **Family offices under $100M.** The proposal drops the `<$250K` step for them. No source is given
  for that, only the absence of one, and the two blogs it cites were read as search snippets.
- **Funds of funds of $100–500M, raised to `$5–25M`.** The basis is the 10–25% ceiling, which bounds a
  commitment rather than giving its typical size.
- **The derived rows** in general. Each divides a dollar-weighted average allocation (endowments' 12.2%
  to venture, private foundations' 15%) by an assumed number of managers. Dollar-weighted averages
  are pulled up by the largest institutions, so a mid-size one allocates less. The number of
  managers is itself a guess. At best these rows confirm the current table's order of magnitude,
  and they do.
- **The six new kinds,** four of them mostly GUESS. The pipeline's research files rarely mention
  them. Of 388 profiles, these words appear in: pension 16, sovereign 7, insurer 6, university
  endowment 4, corporate venture 4. Those are mentions, not the LP's own kind, so they are upper
  bounds. New GUESS constants cut against the rule that guesses should not outlive real data.
- **[MITIMCO] and [SWFI-GEN].** Neither has a primary page. Don't use them.

**Better evidence, already on hand.** About $60M is committed to Neurotech and $30M to Rails. Each
commitment, set beside the LP's kind and size from its profile, is a data point for exactly this kind
of fund. Recorded amounts are soft unless a field is designated as signed. Fitting the table to those
data points is a local job on real data, with no web access, and is the way to retire the GUESS
markers. Proposed as the next step.

**Second opinion.** The brief contains only public data, so it can go to ChatGPT's deep research
unchanged. Compare anything it finds with the table here.

## 1. Summary

**What sources agree on.** Bigger allocators give a bigger share of assets to private
equity and venture capital than smaller ones, consistently across endowments (NACUBO-
Commonfund), foundations (Council on Foundations-Commonfund), family offices (UBS) and
wealth managers (KKR's RIA survey). Within that private allocation, PE consistently gets
more than VC specifically — roughly 2:1 to 3:2 across the endowment and foundation data.
Private-market allocations have risen across nearly every institutional kind over the last
decade (insurers 7%→21% of general-account assets, 2015→2025; foundations and pensions
both trending up over 20 years). And almost every institutional kind — public pensions,
sovereign wealth funds, endowment OCIOs — reaches first-time and emerging managers mainly
through a dedicated program, fund-of-funds, or specialist platform, not through ordinary/
default allocation. That last point matters most for this table: it means "typical
commitment by size" is the wrong frame for several kinds unless a program exists to make
the introduction at all.

**Where sources disagree.** UBS's own 2025 and 2026 Global Family Office Report coverage
gives inconsistent private-equity-allocation directions in secondary write-ups — one 2025
recap states 21%, one 2026 recap states a decline framed inconsistently across sites (22%→
17% in one summary, "42% alternatives / 29% private markets" in another using a different
category cut). I could not resolve this from search summaries alone and did not spend
budget fetching the primary UBS PDF a second time; both figures are reported below with
their source flagged. Market-wide "share of dollars going to first-time managers" also
varies by framing: one figure is $38B raised by first-time funds in 2025 vs. $52B in 2022;
another, differently scoped, puts 90.9% of a $62.4B 2026 cohort with established firms
(≈9% to emerging managers). Same direction (declining, minority share), different numbers.

**Biggest gaps.** Two are structural, not just missing search hits:

1. **"Share backing emerging managers" by LP kind is essentially unsourced.** No source
   found gives this as a percentage broken out by kind. Every cell in that column below is
   "no public source found," with qualitative context where I have it. This is the biggest
   shortfall against what the brief asked for.
2. **Commitment size, specifically for a first-time $50–150M fund, by LP kind and LP size
   band, does not exist as a published table anywhere I could reach.** Every number in the
   "typical commitment" column is either a narrow, imperfectly comparable example (a
   specific pension's specific check into a specific fund), or derived from an allocation
   percentage and an assumed number of manager relationships, with the arithmetic shown.
   None of it is a clean primary statistic. Preqin and PitchBook almost certainly have this
   broken out in their paid platforms; I could not reach it through a public summary.

Three kinds have close to no public data at all: **corporate pension** (one 1992 study,
otherwise nothing VC-specific or size-banded), **corporate venture arm acting as a fund LP**
(CVCs mostly invest off the balance sheet directly, not as fund LPs, and I found no
size-banded figures for the exception cases), and **a venture GP investing personally in a
peer's fund** (nothing distinguishes this from ordinary HNW/angel behavior — see §11 below;
I recommend not treating it as a separate kind in the config).

One structural point worth stating plainly, because it affects every large-LP row in the
table: raw capacity (assets × typical allocation ÷ number of manager relationships) implies
checks well over $25M for the largest pensions, sovereign funds and endowments. But a fund
raising $50–150M cannot actually absorb that from one LP without breaching ordinary
concentration norms (an LP rarely wants to be more than 10–25% of a fund). So for *this*
fund size, even the biggest institutions cap out in practice well below their raw capacity.
The current table already reflects this by never using the `>$25M` band — every kind tops
out at `$5–25M` — and nothing I found gives a sourced reason to change that ceiling.

---

## 2. Table: kind × LP size band

Bracketed keys refer to Part 3. "Derived" means I computed it from a sourced percentage or
example plus a stated assumption; the arithmetic is shown. "GUESS" means no source and no
defensible derivation — carried through unchanged from Juan's original estimate, or newly
guessed and labelled as such. Size bands are the LP's own size (assets, AUM, endowment,
net worth); commitment bands reuse the product's existing labels
(`<$250K · $250K–1M · $1–5M · $5–25M · >$25M`) so the table maps directly onto
`config.capacity.bySize`.

### Single-family office (measure: investable assets)

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$500M | $250K–1M — derived: 6–10% VC allocation [VAVC-FO] spread thin; below this scale a fund's own minimum usually binds before capacity does | no public source found | $100K–500K, the fund's own stated floor, not the LP's [DEFIANT] |
| $500M–2B | $1–5M — median single-family-office PE-fund check ~$3–5M [VAVC-FO] | no public source found | as above |
| >$2B | $5–25M — anchor checks of $5–15M reported [VAVC-FO], capped at the band ceiling (see summary) | no public source found | LP-chosen, $5M+ when anchoring, not a fund floor |

### Multi-family office / wealth manager (RIA, OCIO) (measure: AUM managed or advised)

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$1B | $250K–1M — derived: ~10% of AUM to private markets [KKR25], spread across many manager relationships serving many clients | no public source found | $100K–500K [DEFIANT], or lower through a feeder |
| $1–10B | $1–5M — derived at the same ratio, larger base | no public source found | as above |
| >$10B | $5–25M — derived, capped at ceiling | no public source found | LP-chosen |

KKR's 2025 RIA survey [KKR25] is the strongest single source here (81% of respondents
manage ≥$500M, 30% ≥$5B, roughly half allocate ≥10% of AUM to private markets) but it gives
no per-fund check size at all — every dollar figure in this row is derived, not read.

### Foundation (measure: endowment/assets)

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$250M | $250K–1M — derived: $100M × 15% VC allocation for private foundations [COF-CF24] ÷ ~15–20 manager relationships ≈ $750K–1M | no public source found | $100K–500K, general fund floor |
| $250M–2B | $1–5M — derived: $500M × 15% ÷ ~20 relationships ≈ $3.75M | no public source found | as above |
| >$2B | $5–25M — derived, capped | no public source found | LP-chosen |

[COF-CF24] (255 foundations, $104.9B combined) is a real, current, named study: private
foundations' VC allocation rose 4 points to 15% in the most recent year measured; PE held
flat at 10%. Community foundations run much lower (VC 3%, PE 6%) — worth keeping distinct
if the config ever splits "foundation" further, though I have not proposed that split here
for lack of a size-banded reason to.

### University endowment (measure: endowment assets) — not in the current config

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$250M | $250K–1M — GUESS; small endowments rarely run a dedicated VC program | no public source found | no public source found |
| $250M–1B | $1–5M — derived: $500M × 12.2% VC [NACUBO25] ÷ ~15–20 relationships ≈ $3–4M | no public source found | as above |
| $1B–5B | $5–25M — derived: $2B × 12.2% ÷ ~20–30 relationships ≈ $8–12M | no public source found | as above |
| >$5B | $5–25M — capped; raw capacity far higher, concentration norms bind first | no public source found | as above |

[NACUBO25] (657 institutions, $944B, FY2025) is the best-attested number in this whole
table: 12.2% dollar-weighted average allocation to venture capital specifically, 16.8% to
private equity, with the >$1B cohort allocating 30%+ to private strategies combined. I read
this through secondary coverage (Mercer, PNC Insights, NACUBO's own press release), not the
member-only study tables themselves — NACUBO's site confirms the detailed by-size-cohort
table is behind membership. One direct, on-point confirmation that this fund's size fits the
endowment emerging-manager channel: [MITIMCO] describes MIT's endowment office running a
program explicitly for managers raising $50–150M — matching this fund almost exactly. I
could not independently verify the site hosting that description, so treat the fund-size
match as suggestive, not proof of typical behavior.

### Public pension (measure: total plan assets) — not in the current config

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$10B | $250K–1M — GUESS; most plans this size run no dedicated VC/emerging-manager channel | no public source found | most plans set a *fund*-size floor (often ~$100M+) before a manager is even eligible, gating this fund at the margin — general finding, no single clean citation |
| $10–50B | $1–5M — anecdotal, low confidence: Oregon PERS committed $5.3M to Mayfield Select III [OIC-MIN25]; a Canadian pension reportedly committed $5M to a $75M first-time climate-tech fund [ALTSS] | no public source found | as above |
| >$50B | $5–25M — GUESS/capped; raw capacity is far higher (WSIB committed $175M to an established manager's much larger fund [WSIB-NEWS], not comparable to a first-time $50–150M fund) but concentration and eligibility gates bind first | no public source found | as above |

This is the row I most wanted a clean number for and could not get one. CalSTRS's
Sapphire-managed emerging-manager platform (~$1.4B across five funds, ~300 manager
relationships historically) [SAPPHIRE-PR] is exactly the right shape of program, but neither
its press release nor the follow-up coverage I could read [IMPACTALPHA] states a typical
per-manager commitment size. A "$20M per fund" figure surfaced in aggregated search results
attributed to this program; I could not trace it to a primary statement and am not citing it
as a number. Treat the whole row as low confidence.

### Corporate pension (measure: plan assets) — not in the current config

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$5B | GUESS — no public source found | no public source found | no public source found |
| >$5B | GUESS — no public source found | no public source found | no public source found |

The only source touching this kind at all is a **1992** Goldman Sachs/Frank Russell study
[GOLDMAN92], cited in an Abell Foundation paper, finding corporate plans then allocated 4.9%
to alternatives (including VC) versus 2.5% for public plans. That is 34 years old and says
nothing about commitment size, minimums, or current behavior. I would not use it for
anything beyond "corporate pensions are a real but historically under-studied VC LP kind."
Current-market data on corporate pensions and VC, specifically, was not reachable within
budget — general pension-and-alternatives coverage exists but does not separate corporate
from public plans, or private equity from venture capital.

### Insurer (measure: general account / total invested assets) — not in the current config

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$10B | $250K–1M — GUESS | no public source found | no public source found |
| $10–50B | $1–5M — derived, low confidence: $20B × 21% private-markets share × 42% of that in PE+VC funds [CLEARWATER25] ≈ $1.76B in PE+VC funds combined, spread across dozens of manager relationships; VC alone is a fraction of that, not broken out | no public source found | no public source found |
| >$50B | $5–25M — GUESS/capped | no public source found | no public source found |

[CLEARWATER25] (101 insurance asset managers/consultants, $4.5T combined unaffiliated
general-account AUM, 2025) is a real, current, named survey, and its two headline numbers
are solid: private-market share of the general account rose from 7% (2015) to 21% (2025),
and 42% of the private-equity-and-equity-alternatives sleeve sits in PE and VC funds. But it
does not split VC from PE within that 42%, and gives no per-commitment or by-size figures,
so everything below the two sourced percentages is a rough derivation, not a read number.

### Sovereign wealth fund (measure: total AUM) — not in the current config

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$25B | $1–5M — GUESS; reachable mainly via a dedicated emerging-manager or fund-of-funds program | no public source found | no public source found |
| $25–100B | $5–25M — GUESS | no public source found | no public source found |
| >$100B | $5–25M — GUESS/capped | no public source found | as below |

The clearest finding here is structural, not a number in a band: large sovereign funds
commonly set their **own** minimum ticket at $50–200M for a direct fund commitment (Saudi
Arabia's PIF was cited around $100M per commitment) — a floor larger than, or comparable to,
this entire fund. Under their ordinary policy, most large SWFs would not participate in a
$50–150M fund directly at all; access runs through a smaller dedicated program instead
(Malaysia's Khazanah Nasional runs one, through its Jelawang Capital subsidiary, aimed at
early-stage managers). I found figures for what Jelawang's own portfolio managers have
raised and deployed into startups, but not what Jelawang itself commits as LP into each
manager's fund, so I have not used those figures as a commitment-size data point. The
$50–200M minimum-ticket figure itself came through aggregated search results without a
single clearly identifiable primary source — flagged low confidence.

### Fund of funds / LP programmes (measure: the FoF's own fund size or program AUM)

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$100M | $1–5M — derived: a $100M FoF spread across ~20–30 manager relationships ≈ $3–5M each | qualitatively high — this is what the vehicle exists to do — but no clean percentage found | no public source found |
| $100–500M | $5–25M — derived, revised up from the current guess: LPs commonly cap a single position at 10–20% of the *target* fund's total size, which for a $50–150M fund (midpoint ~$100M) implies $10–20M; a diversified FoF's own concentration limits point to a similar range from the other direction | as above | as above |
| >$500M | $5–25M — capped | as above | as above |

The 10–20%-of-target-fund concentration figure is a generic LP-policy statement, not
FoF-specific — I'm applying it to FoFs because it's their explicit mandate to size positions
this way, but it wasn't stated about fund-of-funds in the source I read it in.

### Corporate venture arm (measure: the CVC's own dedicated fund or allocation) — not in the current config

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$100M | GUESS — no public source found | no public source found | no public source found |
| >$100M | GUESS — no public source found | no public source found | no public source found |

Most corporate venture arms invest directly off the parent's balance sheet rather than as an
LP in someone else's fund; the ones that do act as fund LPs (Nestlé's fund-of-funds sleeve,
TELUS committing alongside its direct program) are described as the exception, not the rule.
Program sizes for CVC arms range roughly $50M to $500M+ (Merck's Global Health Innovation
Fund grew from an initial $125M to a $500M evergreen vehicle) but that's the size of their
own direct-investment pool, not a fund-LP commitment figure. The only check-size numbers I
found ($1–5M as a typical institutional VC-fund entry minimum) are generic, not CVC-specific.
I did not build a table from that — it would be a guess wearing a citation.

### Venture GP investing personally — not proposed as a config kind

No public source distinguishes a venture capital GP's personal investment as an LP in a
peer's fund from ordinary HNW/angel behavior. The one adjacent statistic that does exist —
GPs commit 1–5% of their **own** fund's size, median closer to 1.5–2% for venture funds — is
a different thing: that's a GP's stake in the vehicle they themselves run, not what they
write as an outside check into someone else's. **Recommendation: don't add a separate
`venture_gp` key.** Route this kind through `individual` until real evidence (a cap table, an
LP list) shows it behaves differently. This is a sourced reason to *not* change the shape,
which is the flip side of the brief's instruction to say why when you do change it.

### High-net-worth individual and angel (measure: net worth) — existing `individual` key

| Size band | Typical single commitment | Share backing emerging managers | Usual minimum |
|---|---|---|---|
| <$25M | <$250K — unchanged, no sourced reason to move it | no public source found | $10K–100K per single angel check [ACA], well below a typical fund minimum |
| $25–100M | $250K–1M — unchanged | no public source found | $100K–500K typical fund floor [DEFIANT] |
| $100M–1B | $1–5M — unchanged; derivation landed a bit lower (~$800K–1.6M: $100M × 12% alternatives [CAPGEMINI26] × ~40% VC/PE share ÷ 3–6 concentrated relationships) but within the same order of magnitude, and nothing sourced clearly beats the existing guess | no public source found | as above |
| >$1B | $5–25M — unchanged, capped | no public source found | fund-chosen, often $5–10M minimum at top-tier funds, which then exclude most individuals [DECILE-VCLAB] |

Two findings worth keeping even though they didn't move a number. First, [CAPGEMINI26]:
alternatives fell to ~12% of HNWI portfolios globally in the most recent report (public
equities outperformed), even though 68% of HNWIs say they intend to increase private-equity
exposure — direction and current allocation are pulling different ways right now. Second,
and more relevant to this fund specifically: [DECILE-VCLAB] reports an average LP check of
$159K in emerging-manager funds generally, with about 90% of those commitments going to
funds targeting **under $15M** — well below this fund's $50–150M range. That suggests
HNW/angel money is typically the majority LP base for micro-funds, not for a fund this size;
here it's more likely a supplementary slice alongside institutional anchors. I could not
verify [DECILE-VCLAB]'s own underlying data source (its site reads as aggregating from its
own accelerator/fund-formation program, not an independent survey) — flagged low confidence,
included because it's the only figure I found that's actually shaped like the brief's ask
(an LP check size, for emerging-manager funds specifically).

The existing `angelFloor` (5+ checks on record → `$100K+ (floor)`) is unchanged — ACA's
numbers ($10K–100K per single company check) are broadly consistent with it but don't test
the "5 checks" threshold itself, which is Juan's own unverified estimate. Still GUESS.

---

## 3. Sources

| Key | Publisher | Title | Year | URL | What I read |
|---|---|---|---|---|---|
| [UBS25] | UBS | Global Family Office Report 2025 | 2025 | https://www.ubs.com/global/en/media/display-page-ndp/en-20250521-global-family-office-report-2025.html | Public summary — secondary coverage of the report's figures (search results, incl. caproasia.com's recap), not the full PDF |
| [UBS26] | UBS | Global Family Office Report 2026 | 2026 | https://www.ubs.com/global/en/wealthmanagement/who-we-serve/family-office-and-uhnw/global-family-office-report.html | Public summary — secondary coverage (modus.news, valueaddvc.com), not the full PDF |
| [NACUBO25] | NACUBO and Commonfund | 2025 NACUBO-Commonfund Study of Endowments | 2025 | https://www.nacubo.org/Research/2025/Public-NCSE-Tables (index page; a direct fetch of this page 404'd) | Public summary — secondary coverage (Mercer, PNC Insights, NACUBO's own press release), found via search; the underlying by-size-cohort tables are member-only |
| [COF-CF24] | Council on Foundations and Commonfund | 2024 Council on Foundations–Commonfund Study of Investment of Endowments for Private and Community Foundations (CCSF) | 2024 | https://cof.org/content/2024-council-foundations-commonfund-study-investment-endowments-private-and-community | Public summary — press release / blog recap, via search |
| [CLEARWATER25] | Clearwater Analytics and DCS Financial Consulting | 2025 Insurance Investment Outsourcing Report (IIOR) | 2025 | https://www.theasset.com/article/54405/insurance-asset-managers-boost-private-market-allocations | Read directly (fetched the article, which reports the survey's headline figures) |
| [KKR25] | KKR | 2025 RIA Survey | 2025 | https://www.kkr.com/insights/2025-ria-survey | Read directly (fetched the page) |
| [CAPGEMINI26] | Capgemini | World Wealth Report 2026 | 2026 | https://www.capgemini.com/wp-content/uploads/2026/06/06_04_Capgemini-Press-release_World-Wealth-Report-2026.pdf | Public summary — press release / secondary coverage (wealthbriefing.com, familywealthreport.com), via search, not the full report |
| [ACA] | Angel Capital Association | FAQs — Angel Investing | ongoing | https://angelcapitalassociation.org/faqs-angel-invest/ | Public summary — search-result synthesis citing this page and secondary sites; page not fetched directly |
| [SAPPHIRE-PR] | Sapphire Ventures / Sapphire Partners | CalSTRS and Sapphire Partners Join Forces to Invest in New and Next Generation VC Managers | undated (recent) | https://sapphireventures.com/press/calstrs-and-sapphire-partners-join-forces/ | Read directly (fetched); confirms program AUM and manager-relationship count, gives no per-fund commitment size |
| [IMPACTALPHA] | ImpactAlpha | CalPERS and CalSTRS find alpha in emerging managers that have earned "the right to win" | undated (recent) | https://impactalpha.com/calpers-and-calstrs-find-alpha-in-emerging-managers-that-have-earned-the-right-to-win/ | Read directly (fetched); confirms CalPERS's $500M TPG NEXT platform allocation, gives no first-time-fund commitment size |
| [OIC-MIN25] | Oregon Investment Council | Public meeting minutes / board book | 2025 | https://www.oregon.gov/treasury/invested-for-oregon/Documents/Invested-for-OR-47OIC-Agenda-and-Minutes/2025/3-05-2025-Public-Book.pdf (and related 2025 minutes) | Public summary — search-result synthesis citing the public board minutes; not independently re-fetched (PDF fetches failed elsewhere in this session), so the $5.3M Mayfield Select III figure is moderate confidence pending direct verification |
| [WSIB-NEWS] | Markets Group / Connect Money | Washington State Investment Board commitment coverage (Menlo Ventures XVII $175M; $1.6B 2024–25 plan) | 2024–2025 | https://www.marketsgroup.org/news/washington-sib-eyes-100m-middle-market-pe-commitment ; https://www.connectmoney.com/stories/washington-state-investment-board-commits-1-6b-across-private-markets/ | Public summary via search |
| [MITIMCO] | Unverified secondary source | Description of MIT Investment Management Company's Emerging Managers program (target: managers raising $50–150M) | undated | not independently confirmed — surfaced in aggregated search results without a clearly identifiable primary page | Search snippet only; low confidence on attribution, the $50–150M fund-size match is the useful part |
| [VAVC-FO] | Value Add VC (valueaddvc.com) | "Family Office Asset Allocation 2026," "Endowments vs Family Offices vs Pension Funds," "Emerging Manager VC Funds 2026" | 2026 | https://valueaddvc.com/blog/family-office-investment-strategy-asset-allocation-benchmarks-for-2026 ; https://valueaddvc.com/blog/endowments-vs-family-offices-vs-pension-funds-how-each-lp-type-allocates-to-vc ; https://valueaddvc.com/blog/emerging-manager-vc-funds-2026-how-first-time-fund-managers-are-winning-lp-capital | Public summary — practitioner blog, read via search snippets, not fetched directly; not a formal survey, moderate/low confidence |
| [FOA-BENCH] | family-office-advisory.com | Family office asset allocation by AUM: $50M to $1B benchmarks | undated | https://family-office-advisory.com/articles/family-office-asset-allocation-benchmarks-by-aum-tier | Search snippet only; practitioner blog, methodology unknown, low confidence |
| [UNCORR-ALTS] | Uncorrelated Alts | Specialist Direct: A Modern Family Office Strategy for Venture Investing | undated | https://www.uncorrelatedalts.com/articles/specialist-direct-a-modern-family-office-strategy-for-venture-investing | Search snippet only; practitioner commentary, low confidence |
| [DEFIANT] | Defiant Capital Group, via Advisor Perspectives | Private Equity for Individual Investors: What the Minimums Really Mean | 2026 | https://www.advisorperspectives.com/commentaries/2026/07/30/private-equity-individual-investors-minimums-mean | Search snippet summary |
| [ALTSS] | Altss | Corporate Venture Capital as LPs: A GP's Guide; How Emerging Managers Can Raise Their First Fund in 2025 | 2025–2026 | https://altss.com/blog/corporate-venture-capital-as-lps-gp-fundraising-guide-2026 ; https://altss.com/blog/how-emerging-managers-can-raise-their-first-fund-in-2025 | Search snippet summaries; practitioner/product blog, low confidence, the Canadian-pension $5M example is a single anecdote from this source |
| [DECILE-VCLAB] | Decile Group / VC Lab (govclab.com) | VC Statistics That Matter to Emerging Managers | 2026 | https://decilegroup.com/articles/vc-statistics ; https://govclab.com/2026/08/10/vc-statistics | Search snippet summary; origin of the $159K average LP check / 90%-under-$15M figures; underlying primary data source not identified in what I read, low confidence |
| [GOLDMAN92] | Goldman Sachs and Frank Russell Company, cited by the Abell Foundation | Increasing Pension Fund Investment in Venture Capital | 1992 (cited in a 1996 Abell paper) | https://abell.org/wp-content/uploads/2022/02/cd-2pensions1996.pdf | Search snippet summary; explicitly dated, context only |
| [SWFI-GEN] | Unclear — aggregated among several directory/explainer sites (Dakota, PipelineRoad, VC Beast) | General commentary on sovereign wealth fund minimum commitment sizes ($50–200M) | undated | none singly reliable enough to name as primary | Search snippet synthesis; low confidence, directional only |

Two fetch attempts found nothing usable and are not cited above: the Morgan Lewis VC/PE
Funds Deskbook page on fund size (PDF, returned undecodable binary content) and Preqin's
2017 "Up & Away: Launching a First-Time Venture Capital Fund" special report (same problem).
A third fetch, NACUBO's Public NCSE Tables page, 404'd.

---

## 4. Proposed `capacity.bySize`

**Current** (`config/deployment.ts`):

```ts
bySize: {
  family_office: [[100e6, '<$250K'], [500e6, '$250K–1M'], [2e9, '$1–5M'], [Infinity, '$5–25M']],
  foundation: [[250e6, '$250K–1M'], [2e9, '$1–5M'], [Infinity, '$5–25M']],
  wealth_manager: [[1e9, '$250K–1M'], [10e9, '$1–5M'], [Infinity, '$5–25M']],
  fund_of_funds: [[100e6, '$1–5M'], [500e6, '$1–5M'], [Infinity, '$5–25M']],
  individual: [[25e6, '<$250K'], [100e6, '$250K–1M'], [1e9, '$1–5M'], [Infinity, '$5–25M']],
} as Record<string, Array<[number, string]>>,
angelFloor: { checks: 5, band: '$100K+ (floor)' },
```

**Proposed replacement** — every step below is annotated; unmarked numbers do not exist in
this file. Adopting this also means teaching `lib/enrich/capacity.ts`'s `KINDS` matcher the
six new kind names (`university_endowment`, `public_pension`, `corporate_pension`,
`insurer`, `sovereign_wealth_fund`, `corporate_venture`) — that file is unchanged here; this
is a note for whoever does the actual merge.

```ts
bySize: {
  /** A family office's or principal's investable assets. */
  family_office: [
    [500e6, '$250K–1M'],  // raised from the old <$500K split — [VAVC-FO][FOA-BENCH]: below ~$500M
                          // AUM, a fund's own minimum tends to bind before capacity does; no source
                          // supports a family office this size writing under $250K once it's active
    [2e9, '$1–5M'],       // [VAVC-FO]: median single-family-office PE-fund check ~$3–5M
    [Infinity, '$5–25M'], // [VAVC-FO]: anchor checks of $5–15M reported; capped at the existing
                          // ceiling — no source justifies going to >$25M for a fund this size
  ],
  /** A foundation's or endowment's assets. */
  foundation: [
    [250e6, '$250K–1M'],  // derived from [COF-CF24] — unchanged from current guess, roughly confirmed
    [2e9, '$1–5M'],       // derived from [COF-CF24] — unchanged, roughly confirmed
    [Infinity, '$5–25M'], // unchanged
  ],
  /** A university endowment's assets. NEW — was previously folded into "foundation," which
   * understates how much larger the biggest endowments run relative to most foundations. */
  university_endowment: [
    [250e6, '$250K–1M'],  // GUESS — no source at this small end
    [1e9, '$1–5M'],       // derived from [NACUBO25] (12.2% dollar-weighted VC allocation)
    [5e9, '$5–25M'],      // derived from [NACUBO25] (the >$1B cohort's 30%+ private-market share)
    [Infinity, '$5–25M'], // capped — concentration norms bind before raw capacity does
  ],
  /** A wealth manager, multi-family office or adviser placing client money in funds: AUM managed. */
  wealth_manager: [
    [1e9, '$250K–1M'],    // derived from [KKR25] — unchanged, roughly confirmed
    [10e9, '$1–5M'],      // derived from [KKR25] — unchanged
    [Infinity, '$5–25M'], // unchanged
  ],
  /** A public pension's total plan assets. NEW. Low confidence throughout — see findings §2. */
  public_pension: [
    [10e9, '$250K–1M'],   // GUESS — most plans this size run no dedicated VC/EM channel
    [50e9, '$1–5M'],      // anecdotal: [OIC-MIN25] ($5.3M), [ALTSS] ($5M) — both low confidence
    [Infinity, '$5–25M'], // GUESS/capped — [WSIB-NEWS] shows $175M is reachable, but only for an
                          // established manager's much larger fund, not a first-time $50–150M one
  ],
  /** A corporate pension's plan assets. NEW. No current-market, VC-specific, or size-banded
   * source found at all — every step here is a GUESS, kept only for shape parity with public_pension. */
  corporate_pension: [
    [5e9, '$250K–1M'],    // GUESS
    [Infinity, '$1–5M'],  // GUESS
  ],
  /** An insurer's general-account / total invested assets. NEW. */
  insurer: [
    [10e9, '$250K–1M'],   // GUESS
    [50e9, '$1–5M'],      // derived, low confidence, from [CLEARWATER25]'s 21% private-market /
                          // 42%-of-that-in-PE+VC figures; VC alone is not broken out from PE
    [Infinity, '$5–25M'], // GUESS/capped
  ],
  /** A sovereign wealth fund's total AUM. NEW. */
  sovereign_wealth_fund: [
    [25e9, '$1–5M'],      // GUESS — [SWFI-GEN], low confidence; reachable mainly via a dedicated
                          // emerging-manager or fund-of-funds program, not a direct commitment
    [100e9, '$5–25M'],    // GUESS
    [Infinity, '$5–25M'], // GUESS/capped — most large SWFs' own $50–200M minimum ticket [SWFI-GEN]
                          // would otherwise exclude a $50–150M fund entirely; this band assumes
                          // access through a smaller dedicated program instead
  ],
  /** A fund of funds or a fund's LP programme: the fund's size. */
  fund_of_funds: [
    [100e6, '$1–5M'],     // derived — unchanged
    [500e6, '$5–25M'],    // raised from the old $1–5M — derived from a generic 10–20%-of-target-
                          // fund LP concentration norm, which for a $50–150M fund implies $10–20M;
                          // the source is not fund-of-funds-specific, so treat as moderate confidence
    [Infinity, '$5–25M'], // unchanged
  ],
  /** A corporate venture arm's own dedicated fund/allocation, when it acts as an LP in someone
   * else's fund (the exception, not the rule — most CVCs invest off the balance sheet directly). NEW. */
  corporate_venture: [
    [100e6, '$250K–1M'],  // GUESS — no size-banded source found
    [Infinity, '$1–5M'],  // GUESS
  ],
  /** A person's net worth. Also covers a venture GP investing personally in a peer's fund — no
   * source distinguishes that case, so it is not a separate kind (see findings §11). */
  individual: [
    [25e6, '<$250K'],     // unchanged — no sourced reason to move it
    [100e6, '$250K–1M'],  // unchanged
    [1e9, '$1–5M'],       // unchanged — derivation from [CAPGEMINI26] landed a little lower
                          // (~$800K–1.6M) but within the same order of magnitude
    [Infinity, '$5–25M'], // unchanged
  ],
} as Record<string, Array<[number, string]>>,
angelFloor: { checks: 5, band: '$100K+ (floor)' },  // unchanged — [ACA]'s per-check figures
                                                     // ($10K–100K) are consistent with this but
                                                     // don't test the "5 checks" threshold itself
```

No step above reaches `>$25M`. That is a deliberate, now-sourced choice, not an oversight:
for a fund raising $50–150M, ordinary concentration norms (an LP rarely wants to be more
than 10–25% of a fund) cap what's typical well below what the largest LPs could otherwise
write. `corporate_venture` and `venture_gp` were the two kinds in the brief's list I most
seriously considered leaving out of the config change entirely, given how thin the sourcing
is; I kept `corporate_venture` as an all-GUESS placeholder (matching the brief's ask to cover
it) and dropped `venture_gp` as a separate kind (a sourced non-change, see §11).
