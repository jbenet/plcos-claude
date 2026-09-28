#!/usr/bin/env bash
# Keep credentials in process memory; the fallback runs only without an env value.
env_or_command() {
  local variable="$1"; shift
  if [ -n "${!variable:-}" ]; then printf '%s' "${!variable}"; else "$@"; fi
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then env_or_command "$@"; fi
