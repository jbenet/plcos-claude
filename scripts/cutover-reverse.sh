#!/usr/bin/env bash
# The reverse cutover: the rollback after team writes (docs/deploy/rev2/00-plan-rev2.md §2 step 6).
# A new freeze of the service database, then the same verified transfer into a NEW database on the
# Mac, never into the frozen pre-cutover original. There is no bidirectional sync and no silent failback.
#
#   bash scripts/cutover-reverse.sh --from <service url> --to <new, empty database url> [--work <dir>]
exec bash "$(dirname "$0")/cutover.sh" run --reverse "$@"
