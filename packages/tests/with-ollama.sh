#!/usr/bin/env bash
# Wrap a command with a private, health-gated ollama — the e2e suite's
# UNCONDITIONAL agent backend (srid's ruling: codex-on-ollama is the default,
# no mock branch for codex state, both platforms). `just test` and
# `just test-quick` both run their cucumber invocation through this, so every
# e2e run has a live ollama serving a small instruct model; hooks.ts seeds each
# throwaway home's codex config to point at it and FAILS LOUD if it's absent.
#
# There is no process-compose here and the flake is zero-input, so ollama joins
# the existing imperative harness as one more health-gated node: start it, gate
# on it, pre-pull + warm the model, run the command, tear down. Cross-platform
# (linux dev + CI, darwin/rasam CI) — `ollama` + a schema-matched `codex` ride
# the `.#e2e` shell (flake.nix); the model caches under XDG so a warm CI box (or
# a laptop) pulls it once.
#
# Usage: with-ollama.sh <command> [args...]
set -euo pipefail

model="${KOLU_E2E_OLLAMA_MODEL:-qwen2.5:0.5b}"
ollama_bin="$(command -v ollama)" || {
  echo "with-ollama: ollama not on PATH — run inside \`nix develop .#e2e\`." >&2
  exit 1
}
# Cache OFF the nix store so a warm CI box (linux pool / rasam) keeps the model
# across runs and a laptop pulls it once — the "pre-pull at setup" store.
cache="${XDG_CACHE_HOME:-$HOME/.cache}/kolu-e2e-ollama"
mkdir -p "$cache"
# Random free loopback port — parallel-safe (several CI lanes share a box) and
# never colliding with a developer's own ollama on the default 11434.
port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
export OLLAMA_MODELS="$cache" OLLAMA_HOST="127.0.0.1:${port}" OLLAMA_KEEP_ALIVE=30m
logdir="${TMPDIR:-/tmp}/kolu-e2e-ollama"
mkdir -p "$logdir"

echo "with-ollama: starting private ollama on 127.0.0.1:${port} (model ${model}, cache ${cache})" >&2
"$ollama_bin" serve >"$logdir/serve.log" 2>&1 &
ollama_pid=$!
# Preserve the wrapped command's exit code across teardown: an EXIT trap whose
# last statement succeeds would MASK a failing suite and turn CI falsely green.
trap 'rc=$?; kill "$ollama_pid" 2>/dev/null || true; exit $rc' EXIT

# Health gate — the dependency edge: the suite cannot start until ollama answers
# (`ollama list` talks to the server, so no curl dependency).
for _ in $(seq 1 60); do
  "$ollama_bin" list >/dev/null 2>&1 && break
  if ! kill -0 "$ollama_pid" 2>/dev/null; then
    echo "with-ollama: ollama died during startup — log:" >&2
    cat "$logdir/serve.log" >&2
    exit 1
  fi
  sleep 1
done
"$ollama_bin" list >/dev/null 2>&1 || {
  echo "with-ollama: ollama never became healthy" >&2
  cat "$logdir/serve.log" >&2
  exit 1
}

# Pre-pull + warm so the first real codex turn isn't a cold multi-minute
# prompt-processing stall (determinism for the poll-until-state waits).
echo "with-ollama: pulling ${model} (cached after first run)…" >&2
"$ollama_bin" pull "$model"
echo "with-ollama: warming ${model}…" >&2
"$ollama_bin" run "$model" "hi" </dev/null >/dev/null 2>&1 || true

# Hand the endpoint + model to the harness (hooks.ts seeds codex config from
# these) and run the wrapped command.
export KOLU_E2E_OLLAMA_BASE_URL="http://127.0.0.1:${port}/v1"
export KOLU_E2E_OLLAMA_MODEL="$model"
exec "$@"
