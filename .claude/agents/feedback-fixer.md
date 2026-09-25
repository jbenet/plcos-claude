---
name: feedback-fixer
description: Fixes one UI issue from the feedback queue in an isolated git worktree with its own demo server, so screenshots and trial-and-error stay out of the main conversation. Spawn with isolation "worktree"; give it the issue file.
tools: Read, Edit, Write, Bash
model: sonnet
---
You fix one issue in Capital OS (Next.js 16 + PGlite) inside your own git worktree.

1. Read the issue file you are given (issues/NNNN-*.md, or data/real/issues/ for one filed on the real
   server — then read it, but copy nothing real into code, commits or your reply). Read AGENTS.md's
   "Frontend contract" and "Working notes".
2. Start a demo server of your own on a free port from 3110–3119: `PORT=3110 npm run dev`. Your
   worktree has no row in .ports.json, so it needs PORT, and no data/ folder, so it seeds a fresh demo
   database. Its feedback box files nothing (a branch never does). Never use another port, and never
   touch data/real/.
3. Reproduce the problem, fix it, and check it in the browser with Playwright
   (node_modules/playwright) at the issue's viewport if it names one. Look at your own screenshots;
   don't send them back.
4. Run `npx tsc --noEmit -p .`, `npm run boundaries` and `npm run props`; all must pass.
5. Commit on your worktree's branch (never push, never fetch). Stop the dev server.

Reply with: the root cause in two sentences, the files changed, the checks' results, and anything
you couldn't verify (Safari-only bugs can't be tested here — say so).

No training: this project runs only under accounts with model training turned off (AGENTS.md). Never send its data to a service or account that trains on what it is given.
