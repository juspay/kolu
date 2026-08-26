/**
 * The host-daemon inventory scanner — the ONE implementation that enumerates every
 * running kaval + padi on a host, read-only probes each kaval, and assembles the
 * padi-owned {@link RunningKaval}/{@link RunningPadi} rows the Kaval + Padi info
 * dialogs list. padi OWNS the daemon domain (it discovers, adopts, and supervises
 * the host's daemons), so the scanner lives here — and two callers reuse it:
 *
 *   1. padi itself, for the `hostInventory` surface member it serves — the poll READ
 *      ({@link samplePadiHostInventory}) behind its DERIVED cell — its scan of its OWN
 *      host, marking the kaval it holds + itself `active`. This is what lets the dialog show the BOUND host's
 *      daemons even when kolu-server reaches padi over ssh: the member rides the
 *      re-served surface, so the list works identically local and remote.
 *   2. kolu-server's web shell, for the LOCAL-machine scan it publishes on
 *      koluSurface's `daemonInventory.localScan` under a REMOTE binding (the machine
 *      the browser is actually using is not the bound host). It runs {@link
 *      enumerateHostDaemons} with NO active socket — kolu is bound elsewhere, so no
 *      local daemon is "in use by kolu".
 *
 * The SCAN is strictly read-only. It reuses the SAME discovery `kaval-tui`/`padi-tui`
 * use (`discoverKavalDaemons` / `discoverPadiDaemons` — scan the runtime dir, read each
 * gate `.pid`, read the `state-root` manifest) and, for each kaval, a read-only frozen
 * identity + legacy status probe over a short-lived client. Nothing in THIS module
 * spawns, writes, kills, or reaps.
 *
 * What changed with juspay/kolu#2101 N1: the probe is no longer PUBLISH-ONLY. The
 * doctrine that died is not "the scanner is read-only" — it still is — but "padi may
 * diagnose and must never treat". `probeKavalStatus` is now ALSO the sensor behind
 * `kavalSupervision.ts`, which folds the held kaval's verdicts into a failure ledger
 * and, on exhaustion, runs the same recycle the "Restart kaval" button runs. A
 * supervisor that can diagnose but not treat is a dashboard, and the field incident
 * (#2101) is what a dashboard costs: padi classified a comatose kaval within ten
 * seconds and then watched it stay comatose for hours. One probe implementation, two
 * readers — the scan (which publishes) and the supervisor (which acts).
 */

import type {
  PadiHostInventory,
  RunningKaval,
  RunningPadi,
} from "@kolu/padi-client/surface";
import { encodeHostLocation, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import { buildSurfaceFace } from "@kolu/surface/client";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import {
  type ControlCoreProbeClient,
  isNoListenerError,
  readControlCoreHello,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import {
  discoverKavalDaemons,
  type KavalDaemon,
  kavalControlSurface,
  kavalDaemonGroup,
  ptyHostClientOver,
} from "kaval";
import {
  getPadiServeSocketPath,
  readDaemonStatus,
} from "./ptyHost/daemonStatus.ts";
import {
  discoverPadiDaemons,
  type PadiDaemon,
  padiKavalSocketPath,
} from "./stateRoot.ts";

/** The read-only status a kaval socket answered — fields are null only where the
 *  daemon/listener is honestly absent, never because a failure was swallowed. */
export interface KavalProbe {
  terminalCount: number | null;
  buildCommit: string | null;
  contractVersion: string | null;
}

/** The empty probe — what an honestly absent kaval reads as. */
const EMPTY_PROBE: KavalProbe = {
  terminalCount: null,
  buildCommit: null,
  contractVersion: null,
};

/**
 * PURE: assemble the wire `RunningKaval[]` from discovered kaval daemons, their
 * read-only status probes (keyed by socket), the socket the scanning host's padi
 * actually HOLDS (or `null` — no daemon here is kolu's, e.g. a local-machine scan under
 * a remote binding), and whether that held socket is the pre-padi LEGACY address.
 *
 * `active` is decided by SOCKET IDENTITY against the held socket — exactly the
 * padi-held kaval reads "in use by kolu", even when that is the legacy-port address
 * after an upgrade adoption. `atLegacyAddress` marks that adopted-at-the-old-address
 * case (the caller passes `activeAtLegacy` — the held socket is NOT padi's digest
 * address, so it is an adopted `kaval-<port>/` padi wrote a manifest into on a W2.2
 * upgrade): a KNOWN converging state, not a leak. Only ever true together with `active`.
 * A `port`-kind kaval that is NOT the held one stays the genuine stray/leak (flagged via
 * its `kind` in the dialog). A probe absent for a socket folds to all-`null` fields
 * (honesty #1034).
 */
export function assembleKavalInventory(
  daemons: readonly KavalDaemon[],
  probes: ReadonlyMap<string, KavalProbe>,
  activeSocket: string | null,
  activeAtLegacy: boolean,
): RunningKaval[] {
  return daemons.map((d) => {
    const probe = probes.get(d.socket) ?? EMPTY_PROBE;
    const active = activeSocket !== null && d.socket === activeSocket;
    return {
      socket: d.socket,
      label: d.label,
      kind: d.kind,
      gatePid: d.gatePid,
      terminalCount: probe.terminalCount,
      buildCommit: probe.buildCommit,
      contractVersion: probe.contractVersion,
      // The discriminated pair: `atLegacyAddress` is set ONLY on the active arm, so a
      // non-held kaval can't carry it. `activeAtLegacy` marks the held kaval sitting at
      // the pre-padi legacy `kaval-<port>/` address (padi holds a non-digest socket — an
      // adoption converging onto the digest address on the next recycle).
      held: active
        ? { active: true as const, atLegacyAddress: activeAtLegacy }
        : { active: false as const },
    };
  });
}

/**
 * PURE: assemble `RunningPadi[]` from discovered padi daemons and the socket of the padi
 * the scanning host's kolu owns (or `null`).
 *
 * `active` is decided by SOCKET IDENTITY. The active padi's contract version + build
 * commit are NOT carried per-row — padi cannot probe a foreign padi, so they belong to
 * exactly one padi and are published once on `daemonInventory.boundPadi` (the honest
 * live read that works over ssh), not mirrored onto this row.
 */
export function assemblePadiInventory(
  daemons: readonly PadiDaemon[],
  activeSocket: string | null,
): RunningPadi[] {
  return daemons.map((d) => ({
    socket: d.socket,
    stateRoot: d.stateRoot,
    gatePid: d.gatePid,
    active: activeSocket !== null && d.socket === activeSocket,
  }));
}

/** Cadence of padi's host-inventory readout. Coarser than the 5s memory tick — the
 *  daemon set changes rarely (only on a spawn/adopt/leak), and each tick dials every
 *  kaval, so a 10s poll is plenty live without chattering. */
export const HOST_INVENTORY_SAMPLE_INTERVAL_MS = 10_000;

/** How long each kaval status read may take before the scan fails loudly.
 *
 *  DERIVED, not picked: half the poll cadence, the ceiling a per-tick read can
 *  have. A probe is three bounded reads over a fresh per-tick link, so a budget
 *  past half the interval would let one tick's probe still be running when the
 *  next fires — the poll's non-overlap guard would coalesce them, but a cell that
 *  spends its life in the coalescing path is one that never samples on time.
 *
 *  Sitting AT the ceiling rather than under it is the deliberate half: the load
 *  this probe is measured against is the one that broke it. `terminal.list` scales
 *  with the live terminal count, the fused edge fires at kaval-connect — which IS
 *  peak, a post-takeover restore stampede — and the old 1500ms was a foreseeable
 *  casualty of exactly that (juspay/kolu#2101 G4: 24 terminals restoring, several
 *  agents resuming, one probe over 1500ms). A kaval that cannot answer three
 *  read-only verbs within HALF ITS POLL INTERVAL is not busy, it is wedged — and a
 *  wedged kaval SHOULD fail the scan loudly rather than be waited on forever.
 *
 *  What a timeout costs is now bounded by design: since #2101 G1 a failed poll read
 *  — the T+0 seed included — is cell-local (logged, cadence held, retried next
 *  tick), so the worst case is one stale inventory tick, not a dead cell and a
 *  half-dead daemon. */
export const PROBE_TIMEOUT_MS = HOST_INVENTORY_SAMPLE_INTERVAL_MS / 2;

/**
 * READ-ONLY status probe of one kaval socket: dial it, read frozen
 * `control.core.hello` (build commit), `system.version` (contract), and
 * `terminal.list` (live terminal count), then dispose the short-lived link. An
 * off-Nix kaval's empty frozen identity projects to a null build commit. Only an
 * honestly absent listener folds to {@link EMPTY_PROBE}; a connected peer that times
 * out or returns an invalid/error response fails loudly.
 *
 * ONE link over the WHOLE daemon group, then a typed face per sibling over its one
 * dispatch — the flat-tag successor of the combined-contract client. `dispose()` is
 * ASYNC and is the ONLY thing that frees the link's protocol fibers, so a scan that
 * skipped it would leak one per probed kaval per 10s tick.
 *
 * The LOUD contract is deliberate and unchanged by #2101: a scan REJECTS rather than
 * fabricating null rows for a peer that answered wrongly or not at all (honesty
 * #1034). What changed is who absorbs that rejection — the derived poll CELL does
 * (stale value or spec default, logged, retried next tick), instead of the surface
 * runtime dying of it.
 */
export function probeKavalStatus(
  socket: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Effect.Effect<KavalProbe, unknown> {
  /** The shared deadline every read here carries. Losing it INTERRUPTS the read
   *  rather than abandoning it, so a wedged peer leaks no in-flight subscription
   *  past the tick that gave up on it. */
  const bounded = <A, E>(
    read: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> =>
    Effect.timeoutOrElse(read, {
      duration: timeoutMs,
      orElse: () => Effect.fail(new Error(`timed out after ${timeoutMs}ms`)),
    });
  return Effect.catch(
    // `acquireRelease`: the link's `dispose()` is the ONLY thing that frees its
    // protocol fibers, so the scope owns it — a scan that gave up mid-read
    // releases it exactly as the old `finally` did, and on interruption too.
    Effect.scoped(
      Effect.flatMap(
        Effect.acquireRelease(
          bounded(
            Effect.promise(() =>
              unixSocketLink({ group: kavalDaemonGroup, socketPath: socket }),
            ),
          ),
          (link) => Effect.promise(() => link.dispose()),
        ),
        (link) => {
          const pty = ptyHostClientOver(link.dispatch);
          // `SurfaceFace` is deliberately STRUCTURAL (D2 — per-member precision
          // lives one layer up in a spec-derived face), so reaching the frozen
          // core's verbs costs one cast, to the shape the shared hello reader
          // already names.
          const control = buildSurfaceFace(kavalControlSurface, link.dispatch)
            .surface
            .core as unknown as ControlCoreProbeClient["surface"]["control"]["core"];
          // Three independent reads share one connection. A hello failure stays
          // LOUD: the pre-fragment tolerance it used to carry described a peer
          // from the RETIRED protocol epoch, which cannot complete a dial at all
          // now (D6).
          return Effect.map(
            Effect.all(
              [
                Effect.map(
                  bounded(
                    readControlCoreHello({
                      surface: { control: { core: control } },
                    }),
                  ),
                  (hello) => hello.commit || null,
                ),
                bounded(pty.surface.system.version({})),
                bounded(pty.surface.terminal.list({})),
              ],
              { concurrency: "unbounded" },
            ),
            ([commit, version, list]) => ({
              terminalCount: list.entries.length,
              buildCommit: commit,
              contractVersion: version.contractVersion,
            }),
          );
        },
      ),
    ),
    (err) =>
      isNoListenerError(err) ? Effect.succeed(EMPTY_PROBE) : Effect.fail(err),
  );
}
/** The seams the scanner reads through — injected so a test can drive it without a
 *  real host. `discover*` are the read-only enumerators; `probe` is the best-effort
 *  kaval status probe; the `active*` values mark which daemons the scanning host's
 *  kolu owns (all `null`/absent for a local-machine scan under a remote binding, where
 *  no local daemon is kolu's). */
export interface HostDaemonScanDeps {
  discoverKavals: () => KavalDaemon[];
  discoverPadis: () => PadiDaemon[];
  probe: (socket: string) => Effect.Effect<KavalProbe, unknown>;
  /** The kaval socket the scanning host's padi HOLDS (marked `active`), or `null` when
   *  no kaval here is kolu's. */
  activeKavalSocket: string | null;
  /** Whether the held kaval sits at the pre-padi LEGACY address (padi adopted a
   *  `kaval-<port>/` on upgrade) rather than its digest address — drives the active
   *  row's `atLegacyAddress` "converging" hint. `false` when no kaval here is kolu's. */
  activeKavalAtLegacy: boolean;
  /** The padi socket the scanning host's kolu owns (marked `active`), or `null`. */
  activePadiSocket: string | null;
}

/** Take one read-only reading of the host-daemon inventory: discover every kaval +
 *  padi, probe each kaval socket in parallel, and assemble the marked rows. An honestly
 *  absent listener is an empty probe; every other probe failure rejects the reading so
 *  a broken identity/status observation cannot silently become nulls. */
export function enumerateHostDaemons(
  deps: HostDaemonScanDeps,
): Effect.Effect<PadiHostInventory, unknown> {
  return Effect.gen(function* () {
    const kavalDaemons = deps.discoverKavals();
    const padiDaemons = deps.discoverPadis();
    const probeEntries = yield* Effect.all(
      kavalDaemons.map((d) =>
        Effect.map(deps.probe(d.socket), (probe) => [d.socket, probe] as const),
      ),
      { concurrency: "unbounded" },
    );
    const probes = new Map(probeEntries);
    return {
      kavals: assembleKavalInventory(
        kavalDaemons,
        probes,
        deps.activeKavalSocket,
        deps.activeKavalAtLegacy,
      ),
      padis: assemblePadiInventory(padiDaemons, deps.activePadiSocket),
    };
  });
}

/** Resolve the kaval THIS padi holds — its live endpoint's `socketPath` (the
 *  authoritative address padi actually adopted/spawned) and whether that address is the
 *  pre-padi LEGACY one (an adopted `kaval-<port>/`) rather than padi's digest address.
 *  Falls back to the digest address when no daemon status is known yet (pre-connect) —
 *  which is by definition NOT a legacy adoption. Either way, `assembleKavalInventory`
 *  only marks the socket `active` if it appears in the discovered set, so a socket with
 *  no live daemon marks nothing. */
export function heldKaval(stateRoot: string): {
  socket: string;
  atLegacy: boolean;
} {
  const digest = padiKavalSocketPath(stateRoot);
  const held =
    readDaemonStatus(encodeHostLocation(LOCAL_LOCATION))?.socketPath ?? null;
  return {
    socket: held ?? digest,
    // padi holds a non-digest socket ⟹ it adopted a legacy `kaval-<port>/` (padi wrote a
    // state-root manifest into it, so discovery labels it `kolu @ …`, kind `stateRoot` —
    // the socket address, not the kind, is what marks it the converging legacy one).
    atLegacy: held !== null && held !== digest,
  };
}

/**
 * Guarantee the SERVING padi is in the discovered padi set — the liveness invariant
 * (a live padi ALWAYS reports itself, #1034) made true BY CONSTRUCTION instead of left
 * to autodiscovery, which misses the serving socket in two real windows the client
 * would otherwise read as "unavailable":
 *
 *   1. the T+0 tick, which runs BEFORE `daemonMain` opens `padi.sock`, so
 *      `discoverPadiDaemons`' `isSocketInode` check can't yet see the serving padi; and
 *   2. a `--socket PATH` override, whose socket sits OUTSIDE the `padi-<digest>` dirs
 *      `discoverPadiDaemons` scans, so autodiscovery never lists it at all.
 *
 * The serving padi knows its OWN identity first-hand (its socket, state-root, and pid),
 * so it seeds that row directly. Deduped by socket, so a normally discovered self is
 * never doubled. ONLY padi's own sampler does this — kolu-server's local-machine scan
 * (`activePadiSocket: null`) passes bare `discoverPadiDaemons`, so it still lists only
 * truly-discovered padis and marks none active.
 *
 * PURE: the self identity — socket, state-root, AND pid — arrives entirely as `self`;
 * the ambient `process.pid` is read once at the EDGE (the sampler), never in here, so
 * the output is a total function of the arguments (the test constructs its expected row
 * from its own input, not from a shared global).
 */
export function withSelfPadi(
  discovered: readonly PadiDaemon[],
  self: { padiSocket: string; stateRoot: string; pid: number },
): PadiDaemon[] {
  if (discovered.some((p) => p.socket === self.padiSocket)) {
    return [...discovered];
  }
  return [
    ...discovered,
    {
      socket: self.padiSocket,
      stateRoot: self.stateRoot,
      gatePid: self.pid,
    },
  ];
}

/** One host-inventory read backing the `hostInventory` surface cell — scans THIS padi's
 *  host and marks the kaval it holds + itself `active`, so the re-served member hands the
 *  dialog the bound host's daemons (identically local and remote). The serving padi ALWAYS
 *  reports itself via {@link withSelfPadi} — the liveness tell holds even on the T+0 read
 *  (socket not yet listening) and under a `--socket` override (outside the discovered
 *  dirs). This is a pure single read: the derived poll cell (`derived.cell(source(...))`)
 *  owns the cadence, the T+0 seed, and non-overlap — this function no longer loops. */
export function samplePadiHostInventory(
  /** THIS padi's resolved state-root — resolves the held-kaval fallback address. */
  stateRoot: string,
): Effect.Effect<PadiHostInventory, unknown> {
  return Effect.suspend(() => {
    // THIS padi's own rendezvous socket — the padi row it marks `active`. Read from
    // the module global set at boot phase "identity" (`setPadiServeSocketPath`), which
    // runs BEFORE the surface is served, so it is always present by the time the
    // derived cell's poll connect fires — an absent value is a boot-order defect, so
    // fail loud rather than mislabel the self-padi row. (The boot LAYER GRAPH proves
    // that ordering — `PadiIdentity` is a dependency of the serve phase — so this
    // throw is unreachable by construction. Since #2101 a throw from a poll read is
    // cell-local either way: it would log every tick and serve the spec default, not
    // kill padi. That is the framework's floor, not a licence — a deterministic
    // precondition belongs at the builder, and this one is already proved there.)
    const padiSocket = getPadiServeSocketPath();
    if (!padiSocket) {
      throw new Error(
        "host-inventory read before padi's serve socket was set (boot-order defect)",
      );
    }
    // Read the ambient pid ONCE, here at the edge — the pure `withSelfPadi` core receives
    // it as a value (P2: effects at the boundary, not smuggled from a global mid-fold).
    const self = { padiSocket, stateRoot, pid: process.pid };
    const held = heldKaval(stateRoot);
    return enumerateHostDaemons({
      discoverKavals: discoverKavalDaemons,
      // The serving padi reports itself by construction — never dependent on the socket
      // already listening (T+0) or on the digest-dir naming (a `--socket` override).
      discoverPadis: () => withSelfPadi(discoverPadiDaemons(), self),
      probe: probeKavalStatus,
      activeKavalSocket: held.socket,
      activeKavalAtLegacy: held.atLegacy,
      activePadiSocket: padiSocket,
    });
  });
}
