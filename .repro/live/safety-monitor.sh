#!/usr/bin/env bash
# #1399 safety monitor — the non-negotiable abort path.
#
# Tails the kernel ring buffer and, on the FIRST amdgpu-fault signature, sets a
# STOP flag and SIGKILLs the driven Chromium (matched by its dedicated profile
# dir). The driver process polls the STOP flag and bails. Keep this running for
# the entire test; it is the thing standing between "precursor probe" and "your
# desktop crashed".
set -u
STOP=/tmp/k1399.stop
ABORTLOG=/tmp/k1399.abort.log
PROFILE_TAG=k1399-profile
PAT='page fault|ring .*timeout|gpu reset|MODE1|VRAM is lost|context is lost|amdgpu.*fault'

rm -f "$STOP"

# Pick a kernel-log source that works without an interactive password.
if journalctl -k -n0 >/dev/null 2>&1; then
  SRC=(journalctl -kf -o cat)
elif dmesg >/dev/null 2>&1; then
  SRC=(dmesg --follow)
elif sudo -n dmesg >/dev/null 2>&1; then
  SRC=(sudo -n dmesg --follow)
else
  echo "FATAL: cannot read kernel log unprivileged. Apply nixos-k1399.nix (dmesg_restrict=0) first." >&2
  exit 2
fi
echo "[safety-monitor] watching via: ${SRC[*]}"

"${SRC[@]}" 2>/dev/null | grep --line-buffered -iE "$PAT" | while IFS= read -r line; do
  ts=$(date -Is)
  echo "$ts GPU-FAULT DETECTED -> ABORT: $line" | tee -a "$ABORTLOG"
  touch "$STOP"
  pkill -9 -f "$PROFILE_TAG" 2>/dev/null
  # one hit is enough; the reset (if any) is already in flight
  break
done
