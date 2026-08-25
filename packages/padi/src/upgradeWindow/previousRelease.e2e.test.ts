/**
 * The real thing, once — boot the PREVIOUS RELEASE's kaval, then bring up the
 * CURRENT build's padi against it and drive Restart kaval (`lifecycle.recycleKaval`).
 *
 * Slow by design: resolves the previous kaval binary (env override from the CI
 * recipe, or `nix build` of the latest version tag after `git fetch --tags`),
 * spawns it at the digest-keyed socket for a private state-root, starts current
 * padi, creates a terminal, recycles, asserts the daemon was replaced and the
 * session survived (parked for restore). Also grounds the shared-artifact
 * inventory against the live runtime dir + state-root (unknown non-log files
 * fail the suite).
 *
 * Own CI recipe (`ci::upgrade-window`) so the ordinary daemon lane stays
 * fast. Generous timeouts; deterministic waits (poll readiness, never
 * sleep-and-hope).
 *
 * Under `KOLU_UPGRADE_WINDOW_REQUIRE=1` (CI): the previous ref MUST be a version
 * tag and the previous kaval store path MUST differ from current #kaval — a
 * same-version collapse is a hard fail, not a green same-checkout recycle.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THE WIRE EPOCH CHANGED HERE (PLAN D6, review #1/#19)
 *
 * This file is partly a HARNESS, and the harness itself had to move. Two of its
 * mechanisms rested on an assumption the flag day retires: that the CURRENT
 * client library can complete a handshake against a PREVIOUS-RELEASE daemon.
 *
 *   1. **Readiness probes are transport-neutral.** A previous-release daemon's
 *      readiness is now read the only two ways that survive a protocol epoch: the
 *      rendezvous ACCEPTS a bare `net.connect()`, and the pid GATE beside it names
 *      a live holder. Nothing is spoken on the socket. (The old probe dialed a
 *      `unixSocketLink` and called `system.heartbeat` — a handshake that can never
 *      complete across the epoch, so the suite would have failed at the FIXTURE,
 *      before any assertion ran.)
 *
 *   2. **`newReadsOld`'s "compatible contract ⇒ adopt" arm is permanently the
 *      RECYCLE arm.** A previous-EPOCH kaval is undecodable to this build, which
 *      is the supervisor's `unspeakable-protocol` observation, and its disposition
 *      is to TAKE THE SURVIVOR OVER. So the assertion inverted: the survivor MUST
 *      be replaced, and the replacement MUST be one this build can speak to.
 *      "Either adopted or recycled" was a real observation while both were
 *      possible; within this epoch only one is, and accepting both would let a
 *      silent same-version collapse pass.
 *
 *   3. **A third arm, `newTakesOverOldPadi`.** The daemon a padi IS, not the one
 *      it supervises. Until PLAN D6/Wave A a cross-epoch PADI was REFUSED — left
 *      standing, the upgrade unconverged until a human intervened — so the
 *      hands-off takeover is proven here against a real previous-release padi.
 *
 * The CLASSIFICATION KIND (`UnspeakableProtocolError`, raised at the first-frame
 * decode rather than at the 30 s hello deadline) is pinned in
 * `yesterdayKaval.test.ts`, against bytes this repo controls. Here we own neither
 * the previous binary's bytes nor its framing, so this file pins the CONSEQUENCE:
 * the current probe never yields an identity for it, and the boot replaces it.
 *
 * `oldReadsNew` keeps the arm that stayed meaningful — the current kaval's own
 * dial — and drops the step that dialed a PREVIOUS-release padi with the CURRENT
 * client (review #19's blocker, structurally unreachable now). What it proves in
 * that direction is the rollback contract: an old build that meets a new-epoch
 * daemon still binds its own gate, stays up, and leaves the pid gate pid-first
 * readable naming a live holder.
 */

import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import {
  connectPadi,
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiHelloIdentity,
} from "@kolu/padi-client/dial";
import {
  padiGatePath,
  padiRuntimeHome,
  padiSocketPath,
} from "@kolu/padi-client/rendezvous";
import {
  LOCAL_LOCATION,
  PADI_SURFACE_VERSION,
  type SavedSession,
  SavedSessionSchema,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import {
  DAEMON_BIND_PID_ENV,
  daemonBuild,
  gatePid,
  isHolderLive,
} from "@kolu/surface-daemon";
import {
  assertPreviousReleaseWindow,
  createProcessReaper,
  isPreviousReleaseTag,
  runPreviousReleaseWindow,
  unknownProtocolFilesOnDisk,
  unknownSharedFileMessage,
  waitForSocket,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import {
  converge,
  createEndpoint,
  outcomeAnomaly,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";
import { Effect, Schema } from "effect";
import { KAVAL_GATE_FILE, PTY_HOST_CONTRACT_VERSION } from "kaval";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { currentPadiBuildIdentity } from "../daemonBoot/buildId.ts";
import { connectKaval, probeKavalForConvergence } from "../ptyHost/connect.ts";
import { padiKavalSocketPath, writeStateRootManifest } from "../stateRoot.ts";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";

/** The saved session, ENCODED by its own schema — so the blob planted on disk is
 *  valid by construction and cannot drift from what a padi of this build reads. */
const encodeSavedSession = Schema.encodeSync(SavedSessionSchema);

/** The drain ceiling padi's binder declares for its probe
 *  (`PADI_DRAIN_TEARDOWN_CEILING_MS` in kolu-server). Restated here for the same
 *  reason the policy below is: the binder lives in a package this one does not
 *  depend on. It is inert on this path — a cross-epoch peer never yields a
 *  drainable probe to fire it — but the probe's shape must still be padi's. */
const PADI_TAKEOVER_DRAIN_CEILING_MS = 2000;

const execFileAsync = promisify(execFile);

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../../..");
const PADI_BIN = join(REPO_ROOT, "packages/padi/src/daemonBoot/bin.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "upgrade-window-rt-"));
/** The spawned daemons' stderr — see {@link daemonLogPath} for why it is kept and
 *  why it lives outside both roots the artifact inventory sweeps. */
const DAEMON_LOG_ROOT = mkdtempSync(join(tmpdir(), "upgrade-window-logs-"));
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const reaper = createProcessReaper();
const required = (): boolean => process.env.KOLU_UPGRADE_WINDOW_REQUIRE === "1";

beforeAll(() => {
  vi.stubEnv(DAEMON_BIND_PID_ENV, String(process.pid));
  vi.stubEnv("XDG_RUNTIME_DIR", RUNTIME_ROOT);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(RUNTIME_ROOT, { recursive: true, force: true });
  rmSync(DAEMON_LOG_ROOT, { recursive: true, force: true });
});
afterEach(async () => {
  await reaper.dispose();
});

// ── Transport-neutral readiness (PLAN D6 / review #1, #19) ───────────────────

/** Does the rendezvous ACCEPT a connection? A bare `net.connect()` — no framing,
 *  no handshake, no client library — so it reads the same across a protocol
 *  epoch. This is the ONLY thing a current build may ask of a previous-release
 *  daemon's socket. */
function socketAccepts(socketPath: string): Promise<void> {
  return new Promise<void>((resolveConnect, rejectConnect) => {
    const socket = connect(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolveConnect();
    });
    socket.once("error", (err) => {
      socket.destroy();
      rejectConnect(err);
    });
  });
}

/** The gate file the test already reads, as a readiness signal: a pid that names
 *  a LIVE holder. Together with {@link socketAccepts} this is "the daemon is up"
 *  stated entirely in facts a protocol break cannot invalidate. */
function requireLiveGateHolder(gatePath: string, label: string): number {
  const pid = gatePid(gatePath);
  if (pid === undefined) throw new Error(`${label} gate has no pid`);
  if (!isHolderLive(pid)) throw new Error(`${label} gate pid ${pid} is dead`);
  return pid;
}

/** Wait for a daemon at `socketPath` to be up, WITHOUT speaking its protocol. */
async function waitForNeutralReadiness(
  socketPath: string,
  gatePath: string,
  label: string,
  ms?: number,
): Promise<number> {
  await waitForSocket(
    socketPath,
    async (path) => {
      await socketAccepts(path);
      requireLiveGateHolder(gatePath, label);
    },
    ms,
  );
  return requireLiveGateHolder(gatePath, label);
}

/** Store path of a kaval bin (…/nix/store/HASH-kaval/bin/kaval → …/HASH-kaval). */
function storePathOfBin(bin: string): string {
  // realpath so symlinked result → /nix/store/.../bin/kaval resolves.
  const real = realpathSync(bin);
  return dirname(dirname(real));
}

/**
 * Assert the mixed-version window is real: previous ref is a version tag and
 * previous kaval's nix store path differs from current. Called under REQUIRE
 * and when the CI recipe has already stamped the env.
 */
function logWindow(opts: {
  ref: string;
  previousStore: string;
  currentStore: string;
}): void {
  assertPreviousReleaseWindow(opts);
  // Loud, greppable proof lines for CI evidence.
  console.log(`previousRelease.e2e: previous ref=${opts.ref}`);
  console.log(
    `previousRelease.e2e: previous kaval store=${opts.previousStore}`,
  );
  console.log(`previousRelease.e2e: current  kaval store=${opts.currentStore}`);
  console.log("previousRelease.e2e: store paths differ — window is real");
}

/** Resolve previous-release kaval binary + window identity for the e2e.
 *
 *  Prefer the CI recipe's stamped env (tag + both store paths already proven
 *  unequal). Local fallback: fetch tags, build latest vX.Y.Z + current, refuse
 *  non-tag / identical stores under REQUIRE. */
async function resolvePreviousWindow(): Promise<{
  bin: string;
  padiBin: string;
  ref: string;
  previousStore: string;
  currentStore: string;
} | null> {
  const envBin = process.env.KOLU_PREVIOUS_KAVAL_BIN;
  const envPadiBin = process.env.KOLU_PREVIOUS_PADI_BIN;
  const envRef = process.env.KOLU_PREVIOUS_KAVAL_REF;
  const envPrevStore = process.env.KOLU_PREVIOUS_KAVAL_STORE;
  const envCurrStore = process.env.KOLU_CURRENT_KAVAL_STORE;

  if (envBin && existsSync(envBin)) {
    if (!envPadiBin || !existsSync(envPadiBin)) {
      if (required()) {
        throw new Error(
          "KOLU_UPGRADE_WINDOW_REQUIRE=1 but KOLU_PREVIOUS_PADI_BIN is missing",
        );
      }
      return null;
    }
    const previousStore = envPrevStore ?? storePathOfBin(envBin);
    let currentStore = envCurrStore;
    if (!currentStore) {
      // Local: build current for the inequality check.
      try {
        const { stdout } = await execFileAsync(
          "nix",
          ["build", "--no-link", "--print-out-paths", ".#kaval"],
          { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
        );
        currentStore = stdout.trim().split("\n").at(-1) ?? "";
      } catch (error) {
        throw new Error("failed to build the current kaval store", {
          cause: error,
        });
      }
    }
    const ref = envRef ?? "unknown";
    if (required()) {
      if (!isPreviousReleaseTag(ref)) {
        throw new Error(
          `KOLU_UPGRADE_WINDOW_REQUIRE=1 but KOLU_PREVIOUS_KAVAL_REF='${ref}' is not a version tag — ` +
            `the recipe must git fetch --tags and refuse the last-kaval-commit fallback`,
        );
      }
      if (!currentStore) {
        throw new Error(
          "KOLU_UPGRADE_WINDOW_REQUIRE=1 but current kaval store path is unknown — " +
            "set KOLU_CURRENT_KAVAL_STORE (the recipe builds .#kaval)",
        );
      }
      logWindow({ ref, previousStore, currentStore });
    } else if (isPreviousReleaseTag(ref) && currentStore) {
      logWindow({ ref, previousStore, currentStore });
    }
    return {
      bin: envBin,
      padiBin: envPadiBin,
      ref,
      previousStore,
      currentStore,
    };
  }

  // Local / unstamped path: fetch tags, require a version tag under REQUIRE.
  await execFileAsync("git", ["fetch", "--tags", "--force"], {
    cwd: REPO_ROOT,
  }).catch(async (localError) => {
    try {
      await execFileAsync("git", ["fetch", "--tags", "--force", "origin"], {
        cwd: REPO_ROOT,
      });
    } catch (originError) {
      throw new AggregateError(
        [localError, originError],
        "failed to fetch version tags for the upgrade window",
      );
    }
  });

  let ref: string | undefined;
  const { stdout: tags } = await execFileAsync(
    "git",
    ["tag", "--sort=-v:refname"],
    { cwd: REPO_ROOT },
  );
  ref = tags
    .split("\n")
    .map((t) => t.trim())
    .find(isPreviousReleaseTag);

  if (!ref || !isPreviousReleaseTag(ref)) {
    if (required()) {
      throw new Error(
        "KOLU_UPGRADE_WINDOW_REQUIRE=1 but no version tag (vX.Y.Z) after git fetch --tags — " +
          "refusing the last-kaval-commit fallback that collapses the window",
      );
    }
    return null;
  }

  try {
    const [prev, prevPadi, curr] = await Promise.all([
      execFileAsync(
        "nix",
        [
          "build",
          "--no-link",
          "--print-out-paths",
          `git+file://${REPO_ROOT}?ref=${ref}#kaval`,
        ],
        { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      ),
      execFileAsync(
        "nix",
        [
          "build",
          "--no-link",
          "--print-out-paths",
          `git+file://${REPO_ROOT}?ref=${ref}#padi`,
        ],
        { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      ),
      execFileAsync(
        "nix",
        ["build", "--no-link", "--print-out-paths", ".#kaval"],
        { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      ),
    ]);
    const previousStore = prev.stdout.trim().split("\n").at(-1) ?? "";
    const currentStore = curr.stdout.trim().split("\n").at(-1) ?? "";
    const bin = join(previousStore, "bin", "kaval");
    const padiBin = join(
      prevPadi.stdout.trim().split("\n").at(-1) ?? "",
      "bin",
      "padi",
    );
    if (!existsSync(bin) || !existsSync(padiBin)) {
      throw new Error(
        `built previous-release binaries are missing: kaval=${bin}, padi=${padiBin}`,
      );
    }
    logWindow({ ref, previousStore, currentStore });
    return { bin, padiBin, ref, previousStore, currentStore };
  } catch (err) {
    throw new Error("failed to build the mixed-version daemon window", {
      cause: err,
    });
  }
}

type ResolvedWindow = NonNullable<
  Awaited<ReturnType<typeof resolvePreviousWindow>>
>;

/** The env a padi daemon is spawned with in this suite. */
function padiEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    [DAEMON_BIND_PID_ENV]: String(process.pid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  return env;
}

/** Where a spawned daemon's stderr is kept.
 *
 *  padi and kaval log to fd 2 (`log.ts`), and this suite spawned them
 *  `stdio: "ignore"` — so a daemon's account of itself was discarded as it was
 *  written. That is what an assertion failure here costs: the arm takes two
 *  minutes, its state-root is deleted in a `finally`, and the only thing left was
 *  `expected false to be true`. Whoever picks the failure up has no way to tell a
 *  spawn that failed and unwound from an autosave that was gated — the two
 *  mechanisms behind a session that never lands — so they re-run and guess.
 *
 *  Deliberately NOT under the state-root or `XDG_RUNTIME_DIR`: both are swept by
 *  `unknownProtocolFilesOnDisk`, and a harness log is not a shared protocol
 *  artifact. Its own dir ({@link DAEMON_LOG_ROOT}), cleaned with the suite. */
function daemonLogPath(name: string): string {
  return join(DAEMON_LOG_ROOT, `${name}.stderr.log`);
}

/** An `stdio` triple that keeps a spawned daemon's stderr in {@link daemonLogPath}. */
function stderrToFile(name: string): ["ignore", "ignore", number] {
  return ["ignore", "ignore", openSync(daemonLogPath(name), "a")];
}

/** The tail of a daemon log, for an assertion message. Absent/unreadable is
 *  reported as such — never silently empty, which would read as "the daemon said
 *  nothing" when it means "we could not look". */
function daemonLogTail(name: string, lines = 60): string {
  const path = daemonLogPath(name);
  if (!existsSync(path)) return `${name}: no log at ${path}`;
  try {
    const all = readFileSync(path, "utf8").trimEnd().split("\n");
    return `${name} (last ${Math.min(lines, all.length)} of ${all.length} lines):\n${all
      .slice(-lines)
      .join("\n")}`;
  } catch (err) {
    return `${name}: log unreadable (${String(err)})`;
  }
}

/** Kill whatever still holds these gates (test hygiene, never an assertion). */
function reapGateHolders(gatePaths: readonly string[]): void {
  for (const gate of gatePaths) {
    const pid = gatePid(gate);
    if (pid !== undefined && isHolderLive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

async function newReadsOld(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release kaval + current padi");

  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-sr-"));
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  const padiSock = padiSocketPath(stateRoot);

  // Manifest so discovery can label the rendezvous (production does this
  // before kaval binds).
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  // 1) Boot PREVIOUS-release kaval at the digest-keyed path current padi will dial.
  reaper.track(
    spawn(window.bin, ["--socket", kavalSocket], {
      stdio: stderrToFile("previous-kaval"),
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: RUNTIME_ROOT,
        [DAEMON_BIND_PID_ENV]: String(process.pid),
      },
    }),
  );

  // Readiness WITHOUT speaking its protocol (D6): the socket accepts and the
  // gate names a live holder. Nothing else is knowable across the epoch.
  const oldPid = await waitForNeutralReadiness(
    kavalSocket,
    kavalGate,
    "previous kaval",
  );
  // The current reader must yield the pid under the pid-first law (the #2011
  // rollback/forward window): the pid is the FIRST tab-separated field, and a
  // reader never depends on what follows. Assert the law, not one release's
  // exact bytes — v2.0.0 wrote a bare pid, v2.2.0 writes `pid\tstartUnixUs`,
  // and this harness tracks whatever the latest release tag is.
  const previousGateBody = readFileSync(kavalGate, "utf8").trim();
  expect(previousGateBody.split("\t")[0]).toBe(String(oldPid));

  // 2) The premise the recycle rests on, measured rather than assumed: this
  //    build's convergence probe cannot obtain an identity from a previous-EPOCH
  //    daemon. It must not resolve — neither an identity (which would mean the
  //    epoch never broke and this whole suite is green-washing a same-version
  //    window) nor `null` (honest absence, which is reserved for "no listener"
  //    and would let a fresh daemon race a live one for the rendezvous).
  const probed = await Effect.runPromise(
    probeKavalForConvergence(kavalSocket),
  ).then(
    (probe) => ({ kind: "resolved" as const, probe }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  if (probed.kind === "resolved") {
    probed.probe?.dispose();
  }
  expect(
    probed.kind,
    "the current probe obtained an identity from a previous-release kaval — the wire epoch did not break, or the window collapsed to same-version",
  ).toBe("rejected");
  console.log(
    `previousRelease.e2e: previous kaval is unspeakable to this build — ${
      probed.kind === "rejected" && probed.error instanceof Error
        ? probed.error.message
        : String(probed)
    }`,
  );

  // 3) Boot CURRENT padi against the same state-root. Its endpoint meets a peer
  //    it cannot decode at a rendezvous whose gate it owns — the supervisor's
  //    `unspeakable-protocol` observation — whose disposition is to TAKE THE
  //    SURVIVOR OVER. (padi itself is the subject of `newTakesOverOldPadi`; here
  //    the current padi is the supervisor, not the survivor.)
  reaper.track(
    spawn(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        PADI_BIN,
        "--state-root",
        stateRoot,
        "--allow-nix-shell-with-env-whitelist",
        "default",
      ],
      { stdio: stderrToFile("current-padi"), env: padiEnv() },
    ),
  );

  await waitForSocket(
    padiSock,
    async (path) => {
      // padi here is the CURRENT build, so the current dial is the right probe:
      // it is the production one, and it is what the calls below need anyway.
      const conn = await Effect.runPromise(connectPadi(path));
      conn.dispose();
    },
    90_000,
  );

  // 4) THE RECYCLE ARM (permanently, this epoch). The survivor is gone and its
  //    replacement is one THIS build can speak to. "Adopted or recycled" was a
  //    real either/or while both were reachable; only one is now, and accepting
  //    both would let a same-version collapse pass as a mixed-version proof.
  const recycledDeadline = Date.now() + 90_000;
  let currentEpochPid: number | undefined;
  while (Date.now() < recycledDeadline) {
    const pid = gatePid(kavalGate);
    if (pid !== undefined && pid !== oldPid && isHolderLive(pid)) {
      currentEpochPid = pid;
      break;
    }
    await sleep(200);
  }
  expect(
    currentEpochPid,
    `the previous-release kaval (pid ${oldPid}) was still holding the gate — an unspeakable survivor must be RECYCLED, not adopted`,
  ).toBeTypeOf("number");
  expect(isHolderLive(oldPid)).toBe(false);

  // …and the replacement really is current-epoch: the same probe that could not
  // read the survivor now reads an identity, at this build's contract version.
  const freshProbe = await Effect.runPromise(
    probeKavalForConvergence(kavalSocket),
  );
  expect(freshProbe).not.toBeNull();
  expect(freshProbe?.identity.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
  freshProbe?.dispose();

  const conn = await Effect.runPromise(connectPadi(padiSock));
  try {
    // 5) Create a terminal so recycle has a session to capture.
    const { id } = await Effect.runPromise(
      conn.client.padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: stateRoot,
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // Wait for autosave to persist the session (deterministic poll).
    const confPath = join(stateRoot, "config.json");
    const sessionDeadline = Date.now() + 15_000;
    let sessionPresent = false;
    while (Date.now() < sessionDeadline) {
      if (existsSync(confPath)) {
        try {
          const raw = JSON.parse(readFileSync(confPath, "utf8")) as {
            session?: { terminals?: unknown[] };
          };
          if ((raw.session?.terminals?.length ?? 0) > 0) {
            sessionPresent = true;
            break;
          }
        } catch {
          // mid-write
        }
      }
      await sleep(100);
    }
    // An exhausted poll used to say only "expected false to be true" — the least
    // informative thing a two-minute suite can say, and it cost a full
    // investigation cycle to learn nothing (b375ed7 on x86_64-linux). It now
    // reports the three facts that separate the two ways this can fail, because
    // NOTHING else distinguishes them after the fact:
    //
    //   - the terminal VANISHED. `lifecycle.create` is a SYNC SHADOW
    //     (`terminalEndpoint/local.ts`): it answers `{id, pid: 0}` and spawns on an
    //     async tail, so a returned id proves only that padi minted one. A failed
    //     spawn unwinds the shadow, and the autosave the shadow armed then fires
    //     over an EMPTY registry and clears the blob.
    //   - the terminal is STILL THERE and the blob stayed empty anyway — the
    //     autosave was gated (a freeze lease, or `suppressed-parked`), which is a
    //     defect in the gate, not in the spawn.
    //
    // padi's own terminal list answers which, and its log says why. The list read
    // is bounded and never itself an assertion: a failure to read it is reported
    // as such, so a diagnostic can never mask the failure it is describing.
    const listing = await Effect.runPromise(
      Effect.catch(
        Effect.timeout(
          firstFrameOrThrow(
            conn.client.padi.surface.terminals.keys(undefined),
            "padi's terminals keys stream yielded no frame",
          ),
          2_000,
        ),
        (err) => Effect.succeed(`unreadable (${String(err)})`),
      ),
    );
    expect(
      sessionPresent,
      [
        `the autosave never persisted a terminal within 15s of lifecycle.create (${id})`,
        `padi's live terminals: ${JSON.stringify(listing)}`,
        `config.json: ${existsSync(confPath) ? readFileSync(confPath, "utf8").slice(0, 2000) : "absent"}`,
        daemonLogTail("current-padi"),
      ].join("\n\n"),
    ).toBe(true);

    // Ground the shared-artifact inventory against the LIVE runtime +
    // state-root: every non-log file must match an inventory diskBasename.
    // An unregistered shared file (the miss a hand-list-only watchdog
    // cannot catch) fails here with instructions.
    const unknown = unknownProtocolFilesOnDisk(
      SHARED_ARTIFACTS,
      RUNTIME_ROOT,
      stateRoot,
    );
    expect(
      unknown,
      unknownSharedFileMessage(SHARED_ARTIFACTS, unknown),
    ).toEqual([]);

    const pidBeforeRecycle = gatePid(kavalGate);
    if (pidBeforeRecycle === undefined) {
      throw new Error("kaval gate has no pid before recycle");
    }

    // 6) Restart kaval — the production recycle path.
    await Effect.runPromise(
      conn.client.padi.surface.lifecycle.recycleKaval(undefined),
    );

    // 7) Daemon replaced: gate pid changed (or the old process is dead and
    //    a new live holder is present).
    const recycleDeadline = Date.now() + 60_000;
    let newPid: number | undefined;
    while (Date.now() < recycleDeadline) {
      const p = gatePid(kavalGate);
      if (p !== undefined && isHolderLive(p) && p !== pidBeforeRecycle) {
        newPid = p;
        break;
      }
      await sleep(200);
    }
    expect(
      newPid,
      `kaval was not replaced after recycleKaval (still ${pidBeforeRecycle})`,
    ).toBeTypeOf("number");
    expect(isHolderLive(pidBeforeRecycle)).toBe(false);

    // 8) Session survived for restore — still on disk with the terminal.
    const after = JSON.parse(readFileSync(confPath, "utf8")) as {
      session?: { terminals?: { id: string }[] };
    };
    expect(after.session?.terminals?.length).toBeGreaterThanOrEqual(1);
    // padi itself stayed up (its gate unchanged through a kaval-only recycle).
    const padiPid = gatePid(padiGatePath(padiSock));
    expect(padiPid).toBeTypeOf("number");
    if (padiPid === undefined) throw new Error("padi gate has no pid");
    expect(isHolderLive(padiPid)).toBe(true);

    // Re-ground after recycle — a new shared file introduced by the fresh
    // kaval must still match the inventory.
    const unknownAfter = unknownProtocolFilesOnDisk(
      SHARED_ARTIFACTS,
      RUNTIME_ROOT,
      stateRoot,
    );
    expect(
      unknownAfter,
      unknownSharedFileMessage(SHARED_ARTIFACTS, unknownAfter),
    ).toEqual([]);
  } finally {
    conn.dispose();
    // Reap kaval (current + any leftover) + padi.
    reapGateHolders([kavalGate, padiGatePath(padiSock)]);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/**
 * The reverse direction — a PREVIOUS-release padi meeting a CURRENT kaval.
 *
 * Re-scoped by D6 to what remains meaningful. The old arm dialed the previous
 * padi with the current client (`recycleKaval`, then read its replacement's
 * gate); across the epoch that dial can never complete, and it was the FIXTURE,
 * not the assertion (review #19). What is left is real and is the rollback
 * story:
 *
 *   (a) the CURRENT kaval's own dial works at this rendezvous — the positive
 *       control that makes (c) non-vacuous;
 *   (b) a PREVIOUS-release padi meeting it does not die: it claims its gate and
 *       stays up, degraded at worst. An old build must not crash when it finds a
 *       daemon from the future;
 *   (c) this build cannot dial that previous padi — the flag day, observed;
 *   (d) whatever the previous padi decided to do about the kaval rendezvous, the
 *       gate there stays PID-FIRST readable and names a LIVE holder (#2011). The
 *       gate format is the one contract that must survive a rollback in both
 *       directions, precisely because it is what the two epochs still share.
 */
async function oldReadsNew(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release padi + current kaval");
  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-reverse-sr-"));
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  const padiSock = padiSocketPath(stateRoot);
  const padiGate = padiGatePath(padiSock);
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  const currentKavalBin = join(window.currentStore, "bin", "kaval");
  if (!existsSync(currentKavalBin)) {
    throw new Error(`current kaval binary is missing: ${currentKavalBin}`);
  }
  reaper.track(
    spawn(currentKavalBin, ["--socket", kavalSocket], {
      stdio: "ignore",
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: RUNTIME_ROOT,
        [DAEMON_BIND_PID_ENV]: String(process.pid),
      },
    }),
  );
  const currentKavalPid = await waitForNeutralReadiness(
    kavalSocket,
    kavalGate,
    "current kaval",
  );

  try {
    // (a) The positive control: this build's real dial completes against the
    //     CURRENT kaval at this exact rendezvous, over this exact transport. Any
    //     later "the dial did not complete" is therefore about the PEER, not
    //     about the harness.
    const kavalConn = await Effect.runPromise(connectKaval(kavalSocket));
    try {
      expect(kavalConn.metadata.contractVersion).toBe(
        PTY_HOST_CONTRACT_VERSION,
      );
      expect(kavalConn.metadata.pid).toBe(currentKavalPid);
    } finally {
      kavalConn.dispose();
    }

    // Boot the PREVIOUS-release padi against the same state-root.
    reaper.track(
      spawn(
        window.padiBin,
        [
          "--state-root",
          stateRoot,
          "--allow-nix-shell-with-env-whitelist",
          "default",
        ],
        { stdio: "ignore", env: padiEnv() },
      ),
    );

    // (b) It comes up and holds its own gate. padi claims the gate BEFORE it
    //     serves, so this is readable without speaking padi's protocol at all —
    //     and it is the honest test of "an old build survives meeting a
    //     new-epoch daemon", which is the thing a rollback depends on.
    const previousPadiPid = await waitForNeutralReadiness(
      padiSock,
      padiGate,
      "previous padi",
      90_000,
    );

    // (c) …and this build cannot speak to it. Bounded, because a peer from
    //     another epoch may answer with bytes we cannot parse OR not answer at
    //     all; either way what is proven is that no usable connection appears.
    //     The classification KIND is pinned against bytes we own, in
    //     `yesterdayKaval.test.ts` — never against a previous binary's framing.
    const dialed = await Promise.race([
      Effect.runPromise(connectPadi(padiSock)).then(
        (conn) => {
          conn.dispose();
          return "connected" as const;
        },
        () => "refused" as const,
      ),
      sleep(30_000).then(() => "no-answer" as const),
    ]);
    expect(
      dialed,
      "this build completed a padi handshake against a previous-release padi — the wire epoch did not break",
    ).not.toBe("connected");
    console.log(`previousRelease.e2e: old padi is ${dialed} to this build`);

    // The previous padi is still standing after all of that.
    expect(isHolderLive(previousPadiPid)).toBe(true);

    // (d) The gate contract that must outlive the epoch, in the rollback
    //     direction: whoever holds the kaval rendezvous now — the current kaval
    //     the previous padi could not speak to, or a companion it spawned in its
    //     place — the gate is pid-first readable and names a live process.
    const holder = requireLiveGateHolder(kavalGate, "kaval after old padi");
    const body = readFileSync(kavalGate, "utf8").trim();
    expect(Number.parseInt(body, 10)).toBe(holder);
    expect(gatePid(kavalGate)).toBe(holder);
  } finally {
    reapGateHolders([kavalGate, padiGate]);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

/**
 * THE HANDS-OFF ARM — a previous-release PADI is TAKEN OVER, with no human.
 *
 * `newReadsOld` covers the daemon a padi supervises (kaval). This one covers the
 * daemon a padi IS: the supervisor here is kolu-server's padi binder, and until
 * PLAN D6/Wave A its disposition for a cross-epoch padi was REFUSE — the survivor
 * left standing, the upgrade permanently unconverged until an operator stopped it
 * out of band. That is the whole point of the change, so it is proven against a
 * REAL previous-release binary and not only at the fold's unit seam.
 *
 * The binder is restated here rather than imported: `ensurePadiBinding` lives in
 * `packages/server`, and the dependency arrow does not point that way. What is
 * restated is only padi's DECLARED convergence surface — the same three values
 * `ensurePadiBinding` supplies (`padiConvergencePolicy`, `probeDaemonIdentity`
 * for a drainable handshake, `connectPadi`) — over the SAME framework
 * `createEndpoint` + `converge`. The disposition under test belongs to the
 * framework, so driving the framework with padi's own values is the honest test;
 * a copy of the binder would be testing the copy.
 *
 * What it asserts, in order:
 *   1. the previous-release padi is UP (transport-neutral readiness, D6);
 *   2. this build's padi probe cannot obtain an identity from it — the premise,
 *      measured against the released artifact rather than assumed;
 *   3. `converge` reports `recycled` — the survivor was replaced, not adopted;
 *   4. the old pid is PROVABLY DEAD and a DIFFERENT live pid holds padi's gate;
 *   5. the replacement speaks THIS build's contract (`PADI_SURFACE_VERSION`);
 *   6. the session planted on disk before the old padi booted SURVIVED the
 *      takeover and is what the new padi serves — seeded from disk, not lost.
 */
async function newTakesOverOldPadi(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release padi + current padi takeover");

  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-takeover-sr-"));
  const home = padiRuntimeHome(stateRoot);
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  // 0) SEED THE DISK before anything boots. The takeover's promise is that the
  //    successor picks up where the survivor left off, and the only channel a
  //    protocol epoch cannot break is padi's own state-root. Planting BEFORE the
  //    previous padi boots (rather than writing under a live one) is deliberate:
  //    a running padi owns `config.json`, and a write under it would race its
  //    own `Conf` flush. The previous padi reads this blob, finds no matching
  //    live PTY, and PARKS it for the restore card — which is exactly the state
  //    a takeover must preserve.
  const plantedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  // Built as a VALUE and encoded by the schema, never hand-written JSON: the
  // point of the assertion downstream is that the new padi SERVES this blob, and
  // a blob the current schema cannot decode would fail there for a reason that
  // has nothing to do with the takeover.
  const plantedSession = {
    terminals: [
      {
        id: plantedId,
        state: "active",
        cwd: stateRoot,
        lastActivityAt: 1,
        git: null,
        pr: { kind: "absent" },
        location: LOCAL_LOCATION,
        restoreTarget: { kind: "none" },
      },
    ],
    activeTerminalId: plantedId,
    savedAt: 1_700_000_000_000,
  } satisfies SavedSession;
  writeFileSync(
    join(stateRoot, "config.json"),
    `${JSON.stringify({ session: encodeSavedSession(plantedSession) }, null, 2)}\n`,
  );

  try {
    // 1) Boot the PREVIOUS-release padi at this state-root.
    reaper.track(
      spawn(
        window.padiBin,
        [
          "--state-root",
          stateRoot,
          "--allow-nix-shell-with-env-whitelist",
          "default",
        ],
        { stdio: "ignore", env: padiEnv() },
      ),
    );
    const oldPadiPid = await waitForNeutralReadiness(
      home.socketPath,
      home.gatePath,
      "previous padi",
      90_000,
    );

    // 2) The premise, measured: this build's convergence probe cannot obtain an
    //    identity from a previous-EPOCH padi. Neither an identity (the epoch
    //    never broke) nor `null` (absence is reserved for "no listener").
    const padiProbe = probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: PADI_TAKEOVER_DRAIN_CEILING_MS,
    });
    const probed = await Effect.runPromise(padiProbe(home.socketPath)).then(
      (probe) => ({ kind: "resolved" as const, probe }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    if (probed.kind === "resolved") probed.probe?.dispose();
    expect(
      probed.kind,
      "this build's probe obtained an identity from a previous-release padi — the wire epoch did not break",
    ).toBe("rejected");
    console.log(
      `previousRelease.e2e: previous padi is unspeakable to this build — ${
        probed.kind === "rejected" && probed.error instanceof Error
          ? probed.error.message
          : String(probed)
      }`,
    );

    // 3) THE TAKEOVER — the binder's own values, over the framework's own verb.
    //
    // The OS-fact injects are the PRODUCTION ones (`bakedOsFactsBin` +
    // `processIdentityAsync` / `osfactsSocketHolders`, exactly as
    // `convergeFront`/`padiBinding` compose them), NOT the suite helpers': the
    // gate here was written by a REAL previous-release padi, so it carries a
    // REAL start instant, and the corroboration that guards the takeover
    // compares that instant against whatever this endpoint's identity reader
    // says. `createEndpointForKoluTest`'s reader is the unit-test fake
    // (`pid * 1000`), which disagrees with every genuine gate — against a
    // v2.0.0 previous release that never showed, because a one-field gate
    // (`pid\n`) never reaches the identity comparison at all; against v2.2.0's
    // two-field gate (`pid\tstartUnixUs\n`) it turned a provably-ours daemon
    // into "no gate of ours names a verified holder" and refused the upgrade.
    // A harness that fakes the OS here is not testing the takeover.
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    let spawns = 0;
    const ep = createEndpoint<
      PadiDaemonClient,
      PadiHelloIdentity,
      PadiConnectionMetadata
    >({
      hostId: "padi",
      home,
      readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
      readSocketHolders: osfactsSocketHolders(osfactsBin),
      policy: {
        capability: "drainable",
        baked: {
          contractVersion: PADI_SURFACE_VERSION,
          build: daemonBuild(currentPadiBuildIdentity().staleKey),
        },
        // padi's declared arms, verbatim from `padiConvergencePolicy`. This is
        // the policy whose unspeakable disposition USED to be refuse.
        onContractSkew: { kind: "drain-newer-else-refuse" },
        onBuildMismatch: { kind: "drain-and-replace" },
        drainBudget: { maxAttempts: 3, onGiveUp: "adopt-stale" },
      },
      probe: (socketPath) => padiProbe(socketPath),
      driver: {
        spawn: Effect.promise(async () => {
          spawns += 1;
          reaper.track(
            spawn(
              process.execPath,
              [
                "--import",
                TSX_LOADER,
                PADI_BIN,
                "--state-root",
                stateRoot,
                "--allow-nix-shell-with-env-whitelist",
                "default",
              ],
              { stdio: "ignore", env: padiEnv() },
            ),
          );
        }),
      },
      connect: (path) => connectPadi(path),
      log: silentLogger,
      onStatus: () => {},
      socketReadyMs: 90_000,
    });

    const outcome = await Effect.runPromise(converge(ep));
    expect(
      outcome.kind,
      `an unspeakable padi must be TAKEN OVER, not left standing (got ${outcome.kind}: ${JSON.stringify(outcomeAnomaly(outcome))})`,
    ).toBe("recycled");
    expect(outcomeAnomaly(outcome)).toBeNull();
    expect(spawns).toBe(1);

    // 4) The old daemon is provably gone, and a DIFFERENT live pid holds the gate.
    expect(
      isHolderLive(oldPadiPid),
      `the previous-release padi (pid ${oldPadiPid}) survived the takeover`,
    ).toBe(false);
    const newPadiPid = gatePid(home.gatePath);
    expect(newPadiPid).toBeTypeOf("number");
    if (newPadiPid === undefined) throw new Error("padi gate has no pid");
    expect(newPadiPid).not.toBe(oldPadiPid);
    expect(isHolderLive(newPadiPid)).toBe(true);
    console.log(
      `previousRelease.e2e: padi TAKEN OVER — ${oldPadiPid} (previous epoch) → ${newPadiPid} (this build)`,
    );

    // 5) …and it really is a padi of this epoch: the connection the takeover
    //    holds handshaked, and a fresh dial reads this build's contract version.
    const held = ep.current();
    expect(held, "the takeover held no connection").toBeDefined();
    const conn = await Effect.runPromise(connectPadi(home.socketPath));
    try {
      expect(conn.metadata.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(conn.identity.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(conn.identity.stateRoot).toBe(stateRoot);

      // 6) SEEDED FROM DISK. The blob planted before any of this booted is
      //    still on disk AND is what the new padi serves — the successor picked
      //    up the survivor's state rather than starting blank.
      const onDisk = JSON.parse(
        readFileSync(join(stateRoot, "config.json"), "utf8"),
      ) as { session?: { terminals?: { id: string }[] } };
      expect(onDisk.session?.terminals?.map((t) => t.id)).toEqual([plantedId]);

      const served = await Effect.runPromise(
        firstFrameOrThrow(
          conn.client.padi.surface.session.get(undefined),
          "the new padi's session cell yielded no frame",
        ),
      );
      expect(
        served?.terminals.map((t) => t.id),
        "the new padi did not seed its session from disk",
      ).toEqual([plantedId]);

      // Same #11 grounding the other arm does: a takeover must not mint a
      // shared on-disk artifact nobody registered.
      const unknown = unknownProtocolFilesOnDisk(
        SHARED_ARTIFACTS,
        RUNTIME_ROOT,
        stateRoot,
      );
      expect(
        unknown,
        unknownSharedFileMessage(SHARED_ARTIFACTS, unknown),
      ).toEqual([]);
    } finally {
      conn.dispose();
      held?.dispose();
    }
  } finally {
    reapGateHolders([home.gatePath, kavalGate]);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

describeDaemon("bidirectional previous-release daemon window", () => {
  it("runs new-reads-old and old-reads-new against distinct stores", async () => {
    const window = await resolvePreviousWindow();
    if (!window) {
      if (required()) {
        throw new Error(
          "previous-release padi/kaval unavailable under KOLU_UPGRADE_WINDOW_REQUIRE=1",
        );
      }
      console.warn(
        "SKIP: no previous-release daemon binaries (set KOLU_PREVIOUS_KAVAL_BIN and KOLU_PREVIOUS_PADI_BIN)",
      );
      return;
    }
    await runPreviousReleaseWindow({
      window,
      newReadsOld,
      oldReadsNew,
    });
    // The third arm — the hands-off PADI takeover. Called here rather than
    // through `runPreviousReleaseWindow` because that helper is shared spine
    // (`@kolu/surface-daemon`, drishti's too) and this arm is padi's alone; its
    // window assertion has already run above.
    await newTakesOverOldPadi(window);
    // Raised from 300 s with the epoch break: three of the waits above are now
    // DEADLINES on a peer that may never answer (the unspeakable classification
    // in `newReadsOld`, the cross-epoch dial in `oldReadsNew`, the padi probe in
    // `newTakesOverOldPadi`), where before every leg completed handshakes in
    // milliseconds. Raised again from 420 s with the takeover arm, which boots a
    // previous-release padi, waits out one silence bound, and boots a current
    // padi in its place. The individual bounds are what keep the suite honest;
    // this ceiling only has to be larger than their sum.
  }, 600_000);
});
