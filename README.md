# Capital OS

Fundraising strategy and operations across PLC Neurotech I, PLC Crypto/Rails, the SPVs and
the grants rail.

L1 is built: the console shell, the five seams, PGlite, the user switcher, the feedback box
and markdown issues. See `CHANGELOG.md` for what landed at each stage and why.

```bash
npm install && npm run dev     # migrates, seeds and serves on :3000
```

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

Then: *"Read CLAUDE.md and CHANGELOG.md, then build the next stage."*

`/system` in the running app shows which seam is running which implementation, and which
constants are still guesses.

## Layout

```
CLAUDE.md          the handoff — decisions, rules, what not to build
CHANGELOG.md       what landed at each stage, with screenshots
docs/              13 research and design documents
design/            33 UI boards; S1–S3 are current, the rest is exploration
issues/            markdown issues; the in-app feedback box writes here
config/            deployment.ts — every deferred decision, one file
lib/               the five seams, each with a local implementation
modules/           schema-per-module; platform is the only one so far
app/               Next.js routes
scripts/           reset · seed · shots · boundaries
.claude/           project-scoped Claude Code settings
```
