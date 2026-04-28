#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
kolu_bin="$(nix build "$root#default" --print-out-paths --no-link)/bin/kolu"

scratch="$(mktemp -d)"
log="$scratch/kolu.log"
kolu_pid=""

cleanup() {
  if [[ -n "$kolu_pid" ]] && kill -0 "$kolu_pid" 2>/dev/null; then
    # The process may exit between the liveness check and cleanup commands.
    kill "$kolu_pid" 2>/dev/null || true
    wait "$kolu_pid" 2>/dev/null || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

# The helper runs under nix develop for Node, but the packaged server should
# start with a production-like env so devshell variables do not leak into PTYs.
env -i \
  HOME="$HOME" \
  USER="${USER:-}" \
  LOGNAME="${LOGNAME:-}" \
  PATH="/usr/bin:/bin" \
  XDG_CONFIG_HOME="$scratch/config" \
  NODE_ENV=production \
  "$kolu_bin" \
  --host 127.0.0.1 \
  --port 0 \
  >"$log" 2>&1 &
kolu_pid="$!"

for _ in {1..80}; do
  url="$(node --input-type=module - "$log" <<'NODE'
import { readFileSync } from "node:fs";

const logPath = process.argv.at(-1);
for (const line of readFileSync(logPath, "utf8").trim().split("\n")) {
  if (!line) continue;
  try {
    const entry = JSON.parse(line);
    if (entry.msg === "kolu listening" && typeof entry.address === "string") {
      console.log(entry.address);
      process.exit(0);
    }
  } catch {
    // Ignore non-JSON lines so startup errors are still printed below.
  }
}
NODE
)"

  if [[ -n "$url" ]] && node --input-type=module - "$url/api/health" <<'NODE'
const url = process.argv.at(-1);
try {
  const response = await fetch(url);
  const body = await response.text();
  process.exit(response.ok && body === "kolu" ? 0 : 1);
} catch {
  // The server may not be accepting connections yet; the outer loop retries.
  process.exit(1);
}
NODE
  then
    echo "kolu health check passed at $url"
    exit 0
  fi

  if ! kill -0 "$kolu_pid" 2>/dev/null; then
    cat "$log" >&2
    wait "$kolu_pid"
  fi

  sleep 0.25
done

cat "$log" >&2
echo "kolu did not become healthy" >&2
exit 1
