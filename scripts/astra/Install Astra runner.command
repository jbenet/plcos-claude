#!/usr/bin/env bash
# Double-click in Finder to install and start the Astra runner as a login item (docs/30-astra-runner.md).
bash "$(dirname "$0")/install.sh"
read -n 1 -s -r -p "Done. Press any key to close."
