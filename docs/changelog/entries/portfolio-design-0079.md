# The portfolio page, redesigned — issue 0079

Juan asked for a simpler vehicle portfolio: the company, its founders (looked up), and a table of the
investments with their multiple so far. The data and import from the earlier 0079 change are unchanged;
this is the page.

- **One table per kind of row, in the house card style.** Companies the fund materials name; companies the
  PL warehouse classifies as portfolio; the company an SPV is researched for. The kinds never share a table,
  so a warehouse classification never reads as a confirmed holding.
- **A company is one row group.** Company and founders span its investments; each investment is a line:
  date with round beneath, fund in the source, amount, multiple so far. Multiples are bold, right-aligned,
  and "Not reported" in words where the source has none, never a zero. The as-of date sits in the card head.
- **Founders are looked up at view time.** A founder whose identity is corroborated links to their page.
  One still on the import's placeholder is plain text; if a namesake is open as a possible match, a quiet
  "possible match ↗" link opens that record to check. A later merge or rejected match changes the page
  without a re-import (`portfolioIdentities` in `lib/enrich/portfolio.ts`, read-only).
- **In touch where it helps.** The fund-materials card says its founders count as In touch under the
  portfolio policy; the warehouse card says plainly that its founders are not counted from this list.
- **Sources once, not on every row.** Documents get short labels (S1, S2) with page pointers; when every row
  cites the same page, it is said once. A Sources card gives each document's dates, confidence as a word,
  and who verified it; founder identity sources and the coverage note sit below.
- **iPad and narrow widths.** Layout follows the card's width (container queries), so iPad landscape keeps
  every column and iPad portrait stacks each company into labelled lines. Nothing depends on hover.
- Empty, not-a-fund and unreadable-file states say what is known and where to import.

Styles live in `app/portfolio/portfolio.module.css`; the page's old rules left `app/globals.css`.

Checked with a browser at 1440×900, 1180×820 and 820×1180 on the demo (an invented portfolio file) and on a
copy of the real data. Typecheck, boundaries and properties pass. At 390 px the app's rail does not
collapse on any page, so every page, this one included, has little room there; that is a shell issue.
