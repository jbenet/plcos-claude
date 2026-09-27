# Driving ChatGPT (Codex) headless from Claude

How Claude runs ChatGPT agents ("Astra") as parallel workers on this Mac (27 Sep 2026). It uses no API key, no
browser and no separate service: the Codex command-line tool that ships inside the ChatGPT app, run once per task.

## The binary

```
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
```
It uses the ChatGPT app's signed-in account. `codex exec` runs one task non-interactively and exits.

## One task = one worktree, one brief file, one command

```bash
bash <<'EOF'                      # use bash: zsh does not word-split unquoted variables
CX=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
G=~/git/<repo>/.git               # the main repo's .git (worktrees share its objects)
W=~/git/<repo>-codex-b1           # a dedicated git worktree for this worker
S=/tmp/briefs                     # where brief files and outputs live
n=task1                           # task name → $S/task1.md is the brief
rm -f $S/$n-last.md
(for m in gpt-6-astra gpt-6-sol; do                     # a second model only if the first is at capacity
  $CX exec -m $m -C $W -s workspace-write \
    --add-dir $G/worktrees/$(basename $W) --add-dir $G/objects \
    --add-dir $G/refs/heads/codex --add-dir $G/logs/refs/heads/codex \
    -o $S/$n-last.md - < $S/$n.md > $S/$n-$m.log 2>&1
  [ -s $S/$n-last.md ] && break                         # finished: never start the fallback
  grep -q "model is at capacity" $S/$n-$m.log || break
done &)
EOF
```

What each flag does:
- **`-C $W`** sets the working folder. Give each worker its own git worktree, e.g. `git worktree add ../<repo>-codex-b1`.
- **`-s workspace-write`** is the sandbox: the worker can write inside `-C` and the `--add-dir` folders, and nowhere else.
- **The four `--add-dir` git paths** let it commit on branches under `codex/*`. Without them, commits fail because a worktree's git data lives in the main repo's `.git`.
- **`--add-dir <data folder>`** grants each extra folder it must read or write, e.g. a research data folder.
- **`-c sandbox_workspace_write.network_access=true -c tools.web_search=true`** turns on web access and search, for research tasks. Leave both off for code tasks.
- **`-o $S/$n-last.md`** writes the worker's final message there. A non-empty file means the task is done.
- **`- < brief.md`** reads the brief from stdin.
- **`( … &)`** detaches the run, so many workers run in parallel. We ran 6–7 at once.

## Writing the brief (the part that matters)

A brief starts with who it is, where, and the first command, then gives the rules, the task and the definition of done:
```
You are Astra, working in <worktree>. Start with: git checkout -B codex/<branch> master
Read AGENTS.md and <the rule files that apply> first. Never read <private data dirs>. Never fetch/pull/push.
<Context and the task, specific: inputs, outputs (exact file formats), what not to do.>
<How to verify: the exact test commands, which must pass.>
Commit on codex/<branch> with a changelog entry. Final message: what changed, test counts, known gaps.
```
- **Make it self-contained.** The worker has no memory of your conversation.
- **Name exact formats and give it a validator to run** (for example `scripts/prospects-check.ts`), so its output imports cleanly.
- **Research tasks:** say it works in rounds, measures each round, changes tactics from the yield, and stops when yield drops.
- **One task per worktree at a time.** A second run in the same worktree can reset the first run's branch.

## Watching and collecting

- **Progress:** `tail -c 600 $S/$n-<model>.log`.
- **Done:** `[ -s $S/$n-last.md ]`, then read `$S/$n-last.md` for the summary.
- **Which are running:** `pgrep -fl "codex exec"`.
- **Integrate yourself:** merge `codex/<branch>` into your integration branch, run the tests on every backend, then ship.

## Pitfalls we hit

- **Running the fallback model on a finished task.** The words "at capacity" can appear inside a finished log. Always check the `-last.md` file first; otherwise a second model re-runs the task and resets the branch.
- **zsh loops:** `for x in "a b"` doesn't split. Run launch scripts under `bash`.
- **Sandbox limits.** Workers can't bind network ports or run dev servers in the sandbox, so browser and HTTP checks come back to you. Tests that need a local database need one the worker can reach: give it an `--add-dir` to that database's folder, and use a test database with invented data.
- **Keep private data out of briefs.** A brief can name files but shouldn't paste real records. Research workers read the data from disk through `--add-dir`.
- **Rate and capacity:** if both models report "at capacity", wait and relaunch; don't loop tightly.
