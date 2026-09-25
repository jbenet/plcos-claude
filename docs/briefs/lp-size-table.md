# Brief: what size of commitment each kind of LP makes (public market data)

A research job on public information only — no LP, no record, nothing from `data/`. Suited to ChatGPT
(deep research) or any agent with the web; it touches no real data, so it may run anywhere.

## Why

`config.capacity.bySize` turns the size of the unit that commits (a family office's assets, a
foundation's endowment, a person's net worth…) into a typical single commitment to one venture fund.
Every step of it today is a GUESS (docs/workflows/w1-profile.md, 1.49). Juan, 25 Sep 2026: "do proper
LP segmentation according to real market info/data".

## The question

For a **first-time, $50–150M early-stage venture fund** (a neurotech thesis; a crypto-infrastructure
fund alongside), what is the typical size of one LP's commitment, by kind of LP and by that LP's size?

Kinds to cover: single-family office; multi-family office and wealth manager (RIA, OCIO); foundation;
university endowment; public pension; corporate pension; insurer; sovereign wealth fund; fund of funds
and LP programmes; corporate venture arm; a venture GP investing personally; high-net-worth individual
and angel.

For each kind: the size measure that predicts commitment size (assets, AUM, endowment, net worth), the
bands of that measure, the typical commitment in each band, how often that kind backs first-time or
emerging managers at all, and the minimum it usually writes.

## What to return

- One table: kind × size band → typical commitment range, the share backing emerging managers, and the
  usual minimum.
- For every number, its source: publisher, title, year, and the page or table (Preqin, PitchBook, NVCA,
  Cambridge Associates, Cliffwater, UBS/Campden family-office reports, NACUBO-TIAA, public pension
  commitment records, ILPA, fund-formation law-firm surveys…). Say where sources disagree.
- Where no good source exists, say so; don't fill the gap with a guess.

## How it lands

Claude checks it against `config.capacity.bySize`, proposes the new steps with their sources in the
comments (the GUESS markers go only where sources back the number), and the W1 and W5 rule files cite
it. Nothing about any LP changes until that merge.
