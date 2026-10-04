#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
if [ ! -f .runtime/bridge-config.json ]; then
    node bridge/server.mjs --init
fi
if [ -f .runtime/bridge.pid ]; then
    saved_pid=$(cat .runtime/bridge.pid)
    case "$saved_pid" in *[!0-9]*|'') exit 1 ;; esac
    if kill -0 "$saved_pid" 2>/dev/null && ps -p "$saved_pid" -o command= | grep -F "$project_dir/bridge/server.mjs" >/dev/null; then
        echo 'Bridge is already running'
        exit 0
    fi
fi
nohup node "$project_dir/bridge/server.mjs" > .runtime/bridge.stdout.log 2> .runtime/bridge.stderr.log < /dev/null &
echo $! > .runtime/bridge.pid
echo 'Bridge process started'
