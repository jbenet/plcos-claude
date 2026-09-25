# Working together: Claude, Codex and the live app

How two coding agents — Claude (Claude Code) and GPT (Codex) — work on this repo on one machine
without overwriting each other, and how the live app stays out of their way. Decided with Juan,
25 Sep 2026. Both agents read AGENTS.md; this file is linked from it.

## The layout

```
plcos-claude-live   .git + master · real :3000 (the only writer of the real DB) · demo :3001
plcos-claude-dev    Claude: claude/* branches · preview :3100 (real snapshot) · demo :3101
plcos-codex-dev     Codex:  codex/*  branches · preview :3200 (real snapshot) · demo :3201
plcos-data/real     the real data, outside every worktree
```

- **One repository, three worktrees.** `plcos-claude-live` holds `.git` and `master`; the other two
  are `git worktree`s of it, each on its own branches. A branch is checked out in one worktree at a
  time, which is the guarantee that nobody edits under someone else. No remotes between them: every
  branch is visible to every worktree at once.
- **The live app runs from master only.** Nobody edits code in `plcos-claude-live`. It changes when the
  integrator merges checked work into master; the real server there is the one process that writes the
  real database. Juan's live links are `:3000` (real) and `:3001` (demo).
- **Each dev worktree has two servers.** A demo on its own fresh demo database, and a preview on a
  snapshot — a copy — of the real database, so in-flight work can be seen on real data. Anything
  clicked or written on a preview lands in the copy and is thrown away; the live database never sees
  it. Ports are `:X00` for the preview and `:X01` for the demo.
- **The real data lives outside every worktree**, in `plcos-data/real`, found through `DATA_ROOT`. The
  live server reads and writes it; workflow jobs write their files there (research findings, tags,
  strategies); a preview copies it.

## Who does what

- **Claude integrates.** It merges `claude/*` and `codex/*` into master after the typecheck,
  `npm run boundaries` and `npm run props` pass on the merged result, resolves conflicts, and writes
  the changelog and the build log.
- **Numbers that could collide are assigned at merge:** a migration's `NNN_` prefix, a changelog
  version (N84 …), a screenshot folder. A migration reaches the real database only after merge, so
  renumbering it before then is safe.
- **Work arrives as issues.** The feedback box files them as it always has — no one filing feedback
  picks an agent. A hint in the text ("I think Codex would be better at this") is taken as a hint.
  Claude triages new issues and requests: it sets `assignee: claude | codex` in the issue's
  frontmatter, and the agent records its branch there. One file per task, so the two never edit the
  same file.
- **Rough split.** Codex: self-contained UI fixes and features, workflow batches (research, fact
  checks, tagging), tests. Claude: schema and migrations, the real server's operations (translate,
  import), cross-cutting changes, integration. Juan can always name who.

## Rules for both

- AGENTS.md's rules hold for both agents, above all the real-data rules and "no training on this
  data, for anyone".
- Only the live server opens the real database: PGlite allows one process per database directory,
  and a second one corrupts it. Everyone else reads files, the live app over HTTP, or a snapshot.
- Nobody fetches, pulls or pushes. Juan pushes master.
- File issues only from the live app (`:3000`, `:3001`), so issue numbers don't collide.

## To build it (the next session's checklist)

1. `DATA_ROOT`: `config.data.root` may be an absolute path; every use joins it safely (40 uses in 23
   files — `path.resolve`, not `path.join(cwd, root)`).
2. Ports from a small untracked file per worktree (`.env.worktree`: `REAL_PORT`, `DEMO_PORT`), read by
   the npm scripts and the screenshot tool; the cookie name carries the port.
3. `npm run preview`: copy `plcos-data/real` into the worktree's own data folder and serve it on the
   preview port, with no Affinity key.
4. Move the repo: the current folder becomes `plcos-claude-live` (master), add the two worktrees, move
   `data/real` to `plcos-data/real` with the real server stopped, and restart it from the live folder on
   `:3000` in its terminal loop.
5. Point the agent files and docs at the new ports and paths.
