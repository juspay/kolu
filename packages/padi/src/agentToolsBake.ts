/**
 * The daemon's AGENT-TOOLS BAKE RECORD, and the supervisor-side drift drain it
 * exists for (juspay/kolu#2146).
 *
 * ## The hole this closes
 *
 * The toolchain a padi stamps into every terminal (`KOLU_AGENT_TOOLS_PATH`, read
 * by kolu-pty's `readAgentToolsBake`) is an env fact frozen at DAEMON SPAWN. padi
 * deliberately outlives kolu upgrades, and its convergence build id
 * (`PADI_BUILD_ID`) is derived from padi's own source closure — the tools bundle
 * is a buildEnv sibling, invisible to that derivation. So a kolu upgrade that
 * changes only the client CLIs leaves the resident padi "current" on every axis
 * the convergence kit can see, while every terminal it spawns keeps a dead
 * build's `kolu` at the head of `PATH`, shadowing the host's (#2146).
 *
 * ## The mechanism
 *
 * Two halves, deliberately split daemon/supervisor:
 *
 *   - **The daemon states a fact.** At boot padi writes its own bake — the raw
 *     `KOLU_AGENT_TOOLS_PATH` value, `""` when unbaked — to `agent-tools-bake`
 *     in its runtime rendezvous dir, beside the `state-root` manifest it already
 *     writes about itself. The runtime dir is boot-wiped, so the record can
 *     never outlive the daemon it describes.
 *
 *   - **A SAME-MACHINE supervisor applies policy.** Before converging, a
 *     supervisor that carries its own bake compares the resident's record with
 *     what IT would forward, and on drift drains the resident once (persist +
 *     exit — its kaval and every PTY survive) so the converge that follows
 *     respawns a daemon with the current toolchain.
 *
 * Exactly two supervisors qualify — kolu-server's local binder (it FORWARDS its
 * bake onto the padi it spawns) and the `padi --stdio` front (its re-exec spawns
 * a daemon of its own closure). The ssh binder must NOT run this check: it
 * compares across machines, where the local bake (`kolu` wrapper + tools env)
 * and the remote bake (`padi-agent`'s self-referential `$out/bin`) are different
 * store paths for the SAME logical toolchain, so a comparison there would read
 * every healthy remote daemon as drifted. The front covers the remote host
 * on-machine, where the comparison is meaningful.
 *
 * ## Why this is not a convergence-identity fold
 *
 * Folding the bake into the reported/expected build id was considered and
 * rejected: the id is compared VERBATIM by the shared kit, and the ssh binder
 * compares it cross-machine (see above) — a folded id would make every remote
 * daemon permanently "mismatched". A separate, same-machine-only pre-check
 * leaves the kit and the wire untouched.
 *
 * ## Subordinate to the kit's build axis, by construction
 *
 * The drain fires ONLY when the resident is the SAME build as the supervisor
 * (`buildsMatch` on the probed identity) — the one transition the kit is blind
 * to. A resident of a DIFFERENT build is answered `foreign-build` and left
 * untouched for the kit's own build-mismatch drain, which owns that
 * transition's breadcrumb (`padi build change on boot:` — pinned by the
 * adoption-padi-upgrade VM proof), its drain budget, and its anomaly surface.
 * Without this gate the pre-check would drain a build-mismatched resident
 * FIRST, the kit would meet an empty rendezvous and log `spawned-fresh`, and
 * the VM proof's grep would hang — which is exactly how CI caught it.
 *
 * ## Dispositions across a mixed-version window
 *
 *   - Record ABSENT (a pre-record daemon, or a probe racing the boot write):
 *     no drift verdict. A pre-record daemon has a different `PADI_BUILD_ID` by
 *     construction (the build that introduced the record changed padi's source
 *     closure), so the kit's ordinary build-mismatch drain already covers it.
 *   - Supervisor UNBAKED (`just dev`, e2e, bare `koluBin`): no drift verdict —
 *     a from-source supervisor has no toolchain opinion and must never recycle
 *     a production daemon over one.
 *   - Drain fails or the probe errors: surfaced to the caller as a typed
 *     outcome (never swallowed), and the caller proceeds to converge — the same
 *     adopt-rather-than-go-dark stance as the kit's drain-budget `adopt-stale`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildsMatch,
  type ConvergenceProbe,
  daemonBuild,
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV } from "kolu-pty";

/** The record's filename inside padi's runtime rendezvous dir (`padi-<digest>/`),
 *  beside `padi.sock` / `padi.pid` / `state-root`. Registered in the
 *  upgrade-window shared-artifact inventory (`upgradeWindow/sharedArtifacts.testlib.ts`). */
export const AGENT_TOOLS_BAKE_RECORD_FILE = "agent-tools-bake";

/** Write the record: the raw `KOLU_AGENT_TOOLS_PATH` value this daemon process
 *  was handed, `""` when unbaked — explicit absence-of-toolchain, distinct from
 *  an absent FILE (a daemon predating the record). Same write shape as kaval's
 *  `writeStateRootManifest` (owner-only dir + file). `env` is injectable so
 *  tests never touch the process env. */
export function writeAgentToolsBakeRecord(
  runtimeDir: string,
  env: Record<string, string | undefined> = process.env,
): void {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(runtimeDir, AGENT_TOOLS_BAKE_RECORD_FILE),
    `${env[AGENT_TOOLS_BAKE_ENV] ?? ""}\n`,
    { mode: 0o600 },
  );
}

/** Read the record back: the recorded raw bake (possibly `""` — an unbaked
 *  daemon), or `undefined` when the file is absent/unreadable (a daemon
 *  predating the record). Never throws — mirrors `readStateRootManifest`,
 *  except `""` stays distinct from absence (both are meaningful here). */
export function readAgentToolsBakeRecord(
  runtimeDir: string,
): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(runtimeDir, AGENT_TOOLS_BAKE_RECORD_FILE), "utf8");
  } catch {
    return undefined;
  }
  return raw.split("\n", 1)[0] ?? "";
}

/** What the drift pre-check found and did. `in-sync` folds every no-verdict
 *  case (no drift, absent record, unbaked supervisor); `foreign-build` is a
 *  drift the kit's own build axis will handle (see the module header); the
 *  failure arms carry the error TEXT so the caller logs it loudly — a failed
 *  drain is surfaced, never swallowed, but it must not brick the boot that
 *  follows. */
export type AgentToolsBakeDriftOutcome =
  | { readonly kind: "in-sync" }
  | { readonly kind: "foreign-build"; readonly recorded: string }
  | { readonly kind: "no-resident"; readonly recorded: string }
  | {
      readonly kind: "probe-failed";
      readonly recorded: string;
      readonly error: string;
    }
  | { readonly kind: "drained"; readonly recorded: string }
  | {
      readonly kind: "drain-failed";
      readonly recorded: string;
      readonly error: string;
    };

/**
 * The same-machine supervisor pre-check: if the resident daemon's recorded bake
 * names a different toolchain than `ownBake` (what THIS supervisor's build
 * would hand terminals), drain the resident so the converge that follows
 * respawns it with the current toolchain.
 *
 * `probe` is the caller's own convergence probe (the kit's
 * `probeDaemonIdentity` product — the same value it hands `createEndpoint`), so
 * the drain rides the frozen control core exactly like the kit's own
 * build-mismatch drain, at the probe's own ceiling. `null` from the probe means
 * nothing is listening — the record was a leftover from a dead daemon and the
 * spawn below needs no help.
 *
 * Never fails: every failure mode is a typed outcome arm the caller logs.
 */
export function drainResidentOnAgentToolsBakeDrift(opts: {
  /** The resident's runtime rendezvous dir (where the record lives). */
  readonly runtimeDir: string;
  /** The resident's socket — what the probe dials. */
  readonly socketPath: string;
  /** The bake THIS supervisor's build carries (raw env value; `""` = unbaked). */
  readonly ownBake: string;
  /** This supervisor's `PADI_BUILD_ID` (`currentPadiBuildId()`; `""` off-nix).
   *  A resident of a DIFFERENT build is `foreign-build` — deferred untouched to
   *  the kit's own build axis, so its drain-once breadcrumb, budget, and the
   *  adoption-padi-upgrade VM proof stay exactly as they were. This check adds
   *  signal only in the one case the kit is blind to: same build, different
   *  toolchain (#2146). */
  readonly ownBuildId: string;
  /** The caller's convergence probe (drainable capability). */
  readonly probe: (
    socketPath: string,
  ) => Effect.Effect<ConvergenceProbe<"drainable"> | null, Error>;
}): Effect.Effect<AgentToolsBakeDriftOutcome> {
  return Effect.gen(function* () {
    const recorded = readAgentToolsBakeRecord(opts.runtimeDir);
    // The whole drift policy, inline so the record's `""`-vs-absent distinction
    // is decided exactly once: an unbaked supervisor never judges; an absent
    // record is the build-mismatch machinery's window, not ours.
    if (
      opts.ownBake === "" ||
      recorded === undefined ||
      recorded === opts.ownBake
    ) {
      return { kind: "in-sync" } as const;
    }
    const probed = yield* opts.probe(opts.socketPath).pipe(
      Effect.map((probe) => ({ kind: "ok" as const, probe })),
      Effect.catch((error) =>
        Effect.succeed({ kind: "err" as const, error: String(error) }),
      ),
    );
    if (probed.kind === "err") {
      return { kind: "probe-failed", recorded, error: probed.error } as const;
    }
    if (probed.probe === null) {
      return { kind: "no-resident", recorded } as const;
    }
    const probe = probed.probe;
    if (!buildsMatch(daemonBuild(opts.ownBuildId), probe.identity.build)) {
      probe.dispose();
      return { kind: "foreign-build", recorded } as const;
    }
    return yield* drainAndAwaitExit(probe.fireDrain, probe.awaitExit, {
      ceilingMs: probe.drainCeilingMs,
    }).pipe(
      Effect.map(({ took, drainRejection }) =>
        took
          ? ({ kind: "drained", recorded } as const)
          : ({
              kind: "drain-failed",
              recorded,
              error:
                `the daemon's socket did not close within ${probe.drainCeilingMs}ms` +
                drainRejectionSuffix(drainRejection),
            } as const),
      ),
      Effect.catch((error) =>
        Effect.succeed({
          kind: "drain-failed",
          recorded,
          error: String(error),
        } as const),
      ),
      Effect.ensuring(Effect.sync(() => probe.dispose())),
    );
  });
}
