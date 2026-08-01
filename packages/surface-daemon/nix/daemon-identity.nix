# mkDaemonIdentity — the ONE Nix recipe for a durable daemon's baked build identity. The
# Nix half of @kolu/surface-daemon's `readBakedIdentity` (the TS half): together they are
# the two halves of the same daemon-identity electricity, so this recipe lives INSIDE the
# surface-daemon package (location is structure) and the repo default.nix imports it — a
# future external consumer of the spine gets the identity recipe from the same box as the
# code that reads it.
#
# A daemon's identity is TWO baked env vars, read back by `readBakedIdentity(<PREFIX>)`:
#   - <PREFIX>_BUILD_ID   — the staleKey: a content digest of the daemon's BEHAVIORAL
#     closure. It flips iff a restart would load different behavioral code.
#   - <PREFIX>_COMMIT_HASH — the navigable git ref it was built from.
#
# ── The staleKey IS the CURRENCY key, and its meaning is the BEHAVIORAL CLOSURE ──────────
# The build id is what a supervisor's convergence compares to decide "is the running daemon
# the one I would spawn?" — and, for a daemon whose staleness response is a HUMAN NUDGE
# (kaval: recycling it to pick up a new build kills live PTYs, so a person decides), it is
# also what fires "update available". So WHAT goes into the hash is a policy decision with
# teeth: it must be the code whose change actually changes the daemon's BEHAVIOR, not every
# byte in its transitive closure.
#
# The lesson, paid for in production (kaval on zest, 2026-07-03): kaval's staleKey once
# hashed the shared `@kolu/surface-daemon` transport SPINE, so a spine-only refactor — with
# no change to kaval's PTY-survival behavior, and a wire contract that stayed COMPATIBLE —
# flipped the staleKey and fired a spurious "update available"; acting on that nudge would
# have recycled kaval and killed live PTYs. A contract-compatible spine change is, BY THE
# CONTRACT'S OWN DEFINITION, behaviorally interchangeable, so keying currency on the spine
# double-counts what the contract version already covers. The fix: a daemon's
# `behavioralFileset` is ITS OWN decision of what counts as its behavior (the POLICY) — the
# hashString-over-`fileset.toSource` recipe + the `--set` bake here are the shared
# ELECTRICITY. (A spine change that DOES matter bumps the wire contract, which the
# supervisor's recycle-on-skew converges as a separate, sanctioned signal.)
#
# Prefer DERIVING the fileset over listing it by hand: a hand-kept file list can silently
# drift from what the process loads (a rebuilt daemon carrying an unchanged identity), while
# the surviving failure direction of a derived set is a harmless extra flip, never a silent
# escape. The derivation is the sibling recipe `workspace-closure.nix`
# (`mkWorkspaceClosure`, juspay/kolu#2094 + #2096): apply it to your name→dir members map
# and hand its `identityInputs { entries; stableLeaves; }` — `behavioralFileset` and
# `pinnedSources` — straight to this function. `stableLeaves` is then the only hand-kept
# list left, and it is pure policy: the closure packages the daemon DELIBERATELY keys no
# currency on.
#
# ── `pinnedSources`: members that are pins, not files ────────────────────────────────────
# A consumer outside kolu's own workspace reaches some `@kolu/*` packages through a
# content-addressed pin (npins, a submodule) rather than a directory it can put in a
# fileset. Those members contribute here instead: each is folded into the hash as
# `<name>=<store path>`, so a PIN BUMP moves the daemon's id exactly like a source edit
# does. Dropping them instead is the silent stale-daemon hole #2094 records (juspay/kolu#2093
# is kolu's own first pinned member). The empty case is byte-identical to hashing `${src}`
# alone — a workspace-only consumer's live daemon ids do not move when this arm lands.
#
# ── What the staleKey deliberately does NOT cover: the runtime ENGINE ────────────────────
# A nixpkgs bump that swaps the daemon's Node/tsx moves the DERIVATION but not this id
# (juspay/kolu#2094's open question — answered: deliberate, with a bounded cost). The id is
# a hash of SOURCE, byte-identical across platforms, because a client on one platform
# compares its baked "expected" id against a daemon provisioned on another — folding
# platform-dependent runtime store paths in would make every cross-platform comparison a
# false mismatch. The cost is bounded staleness: an engine-only deploy is adopted, not
# converged, until the next source change flips the key (in practice: days, and an engine
# bump that changes observable behaviour is precisely a wire-contract/package.json event,
# which IS keyed). A platform-independent engine marker (e.g. nodejs.version) could close
# even that window, at the price of nudging kaval's human on every nixpkgs bump — rejected
# while the recorded incidents all point the other way (over-firing, not under-firing).
{ lib }:
{ name        # the daemon's name (for labels/errors)
, prefix      # its identity-env namespace: "KAVAL", "PADI", …
, root        # the fileset.toSource root (a common ancestor of behavioralFileset)
, behavioralFileset # WHAT counts as this daemon's behavior — ITS OWN decision (see above)
, pinnedSources ? { } # behavioral members that are PINS, not files: name → store path
, commitHash  # the navigable git ref this build was made from
, override ? null # TEST-ONLY: force the build id for a build-skew VM arm; real builds hash
}:
let
  # Content-addressed: `fileset.toSource` adds the behavioral closure to the store at eval
  # time, so its store path already changes iff any behavioral file changes — hash that path
  # to a stable, platform-independent 64-char id. Computed PURELY in Nix (no IFD), so
  # `nix flake check` evaluates every output without realising a build mid-eval.
  src = lib.fileset.toSource { inherit root; fileset = behavioralFileset; };
  # The pinned members' contribution, one `name=<store path>` line each. `mapAttrsToList`
  # walks `attrNames`, which Nix keeps sorted, so the lines are order-stable across
  # evaluations. Every value must BE a Nix store path — content- or input-addressed; either
  # one moves when the pin moves, which is the whole property this arm needs. A path outside
  # the store would make the id a lie, naming bytes that can change under the running daemon
  # without the id moving.
  #
  # The check tests the TYPE first and then the prefix, and reports the offending ATTR NAMES
  # rather than dumping values: an uncoerced, path-typed value must land on THIS message and
  # be told which member to fix, not on `lib.hasPrefix`'s "path does not exist" from the
  # store realisation Nix would attempt while coercing it.
  badPinned = lib.attrNames (lib.filterAttrs
    (_: p: !(builtins.isString p && lib.hasPrefix "${builtins.storeDir}/" p))
    pinnedSources);
  pinnedLines =
    assert lib.assertMsg (badPinned == [ ])
      "${name}: every pinnedSources value must be a STRING naming a path under ${builtins.storeDir}/ — these are not: ${toString badPinned}. A daemon identity cannot be keyed on a mutable path, and a path-typed value would be NAR-copied into the store under a fresh hash instead of naming the pin.";
    lib.mapAttrsToList (n: p: "${n}=${p}") pinnedSources;
  buildId =
    if override != null then override
    # No pins: hash the fileset's store path ALONE, byte-for-byte the input this recipe has
    # always hashed — a workspace-only consumer's live daemon ids must not move because the
    # pinned arm exists.
    else if pinnedSources == { } then builtins.hashString "sha256" "${src}"
    else
      builtins.hashString "sha256"
        (lib.concatStringsSep "\n" ([ "${src}" ] ++ pinnedLines));
in
{
  inherit buildId;
  # The wrapper `--set` pair baking this daemon's identity env — both vars it reads via
  # `readBakedIdentity`'s `<PREFIX>_*` namespace, so they can only be set as a pair. Spliced
  # into a `makeWrapper` invocation; the values are hex ids with no shell-special chars.
  bakeArgs =
    assert lib.assertMsg (commitHash != "")
      "${name}: commitHash is required when baking a daemon build identity";
    ''--set ${prefix}_BUILD_ID "${buildId}" --set ${prefix}_COMMIT_HASH "${commitHash}"'';
}
