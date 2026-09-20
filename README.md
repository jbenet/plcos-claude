# Capital OS

Fundraising strategy and operations across PLC Neurotech I, PLC Crypto/Rails, the SPVs and
the grants rail.

Nothing is built yet. This repo currently holds the research, the design and the plan.

## Where to start

| | |
|---|---|
| **`CLAUDE.md`** | The handoff. Stack, the five seams, the twelve non-negotiable domain rules, the frontend contract, and an explicit do-not-build list. Read this first. |
| **`docs/13-synthesis-r3.md`** | The current plan. Supersedes docs 10–12. Module map, build sequence L1–L13, and what was deliberately refused. |
| **`docs/09-system-architecture.md`** | The underlying design: data model, two planes, connector contract, agent runtime. |
| **`design/index.html`** | The visual spec. `S1`–`S3` are the current direction; open in a browser. |
| **`docs/01`–`08`** | The research the design rests on. Consult as questions come up; don't read all upfront. |

## To develop

```bash
cd ~/git/plc-os/plcos-claude
claude
```

Then: *"Read CLAUDE.md and docs/13-synthesis-r3.md, then build L1."*

L1 is the console shell, PGlite, a user switcher, the feedback box, markdown issues, the
issues page and seed data. Roughly four days. Nothing else.

## Layout

```
CLAUDE.md          the handoff — decisions, rules, what not to build
docs/              13 research and design documents
design/            33 UI boards; S1–S3 are current, the rest is exploration
issues/            markdown issues; the in-app feedback box writes here
.claude/           project-scoped Claude Code settings
```
