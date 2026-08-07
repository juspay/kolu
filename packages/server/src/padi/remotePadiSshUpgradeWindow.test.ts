/**
 * F4's falsifier — the REMOTE upgrade window, over a REAL ssh hop.
 *
 * The juspay/kolu#2101 incident, inverted into an assertion. A PREVIOUS-RELEASE
 * padi is left RESIDENT on a real ssh host — a genuinely previous-epoch daemon
 * holding the rendezvous socket and the pid gate — and then a CURRENT build dials
 * that host through the exact production stack (`makeSession` +
 * `sshConnector` → `ssh <host> padi --stdio` → readiness banner → `stdioLink`).
 *
 * The acceptance criterion is the inverse of the incident:
 *
 *     ONE takeover and ONE clean converge, NOT a loop.
 *
 * Pre-fix, this dial produced the gist's signature: the ssh child's stdio went
 * straight to `stdioLink`, the RPC pinger attached to a mute previous-epoch peer,
 * the link died ~10s later, the failure classified `"network"` (uncounted,
 * unterminable) and the session reconnected forever. So the negative is asserted
 * as loudly as the positive: no `failed` frame, at most one fresh campaign, and a
 * bounded wall clock.
 *
 * WHAT MAKES THIS REAL (each of these is a place a cheaper test would go false):
 *
 *   - The resident daemon is a REAL previous RELEASE, `nix build`-ed from the
 *     latest `vX.Y.Z` tag and copied to the host — not a fixture that imitates
 *     one. Its store path is asserted DIFFERENT from the current build's, so a
 *     same-version collapse cannot green-wash the run.
 *   - It runs on the REMOTE box, where the gate file, the pid table and the
 *     signals actually live — which is precisely the ground the remote arm had
 *     no epoch handling on.
 *   - The dial is the production connector. Nothing here reaches past it to
 *     simulate the splice.
 *
 * GUARDED: skipped unless the environment names a real non-loopback ssh host, the
 * current padi `.drv`, and a previous-release padi already provisioned on that
 * host. A loopback host is refused as a FALSE GREEN (`isLocalHost` runs the
 * binary directly — no ssh at all).
 *
 *   KOLU_E2E_SSH_HOST             a non-loopback ssh host/alias reaching a real sshd.
 *   KOLU_E2E_PADI_DRV             the CURRENT padi `.drv` the front is provisioned from.
 *   KOLU_E2E_PREVIOUS_PADI_STORE  the PREVIOUS release's padi store path, already
 *                                 copied to the host (the recipe does the copy).
 *   KOLU_E2E_PREVIOUS_PADI_REF    the version tag that store was built from (`vX.Y.Z`).
 *   KOLU_E2E_CURRENT_PADI_STORE   the current padi store path — compared against the
 *                                 previous one so the window is provably real.
 *
 * TURNKEY: `just e2e-ssh-upgrade <host>` resolves the latest release tag, builds
 * both padis, refuses an identical pair, copies the previous closure to the host,
 * and runs this file. CI has NO ssh lane (no sshd in the build sandbox), so that
 * recipe is the ONLY enforced run of this suite — deliberately, and stated here
 * so the coverage cap is never silent.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import { type PadiDaemonClient, padiClientOver } from "@kolu/padi/dial";
import { padiDigest } from "@kolu/padi/stateRoot";
import {
  PADI_SURFACE_VERSION,
  padiDaemonGroup,
  padiSurfaceSibling,
} from "@kolu/padi/surface";
import { isContractVersionCompatible } from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { assertPreviousReleaseWindow } from "@kolu/surface-daemon/upgrade-window.testlib";
import type { AgentClient } from "@kolu/surface-remote";
import {
  buildSshProbeCommand,
  directAgentDerivation,
  isLocalHost,
  makeSession,
  type SessionState,
  type SshProv,
  sshConnector,
} from "@kolu/surface-remote";
import { TEST_BINARY_CACHE } from "@kolu/surface-remote/agentDerivation.testutil";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SSH_HOST = process.env.KOLU_E2E_SSH_HOST;
const PADI_DRV = process.env.KOLU_E2E_PADI_DRV;
const PREVIOUS_PADI_STORE = process.env.KOLU_E2E_PREVIOUS_PADI_STORE;
const PREVIOUS_PADI_REF = process.env.KOLU_E2E_PREVIOUS_PADI_REF;
const CURRENT_PADI_STORE = process.env.KOLU_E2E_CURRENT_PADI_STORE;

const present = (v: string | undefined): v is string =>
  v !== undefined && v !== "";

const enabled =
  present(SSH_HOST) &&
  present(PADI_DRV) &&
  present(PREVIOUS_PADI_STORE) &&
  present(PREVIOUS_PADI_REF) &&
  present(CURRENT_PADI_STORE);

// A loopback host runs the binary DIRECTLY (`isLocalHost` in `buildAgentCommand`),
// so the whole ssh leg — the leg this suite exists to cover — would be skipped
// while the suite reported green. Refuse it loudly.
if (enabled && isLocalHost(SSH_HOST)) {
  throw new Error(
    `KOLU_E2E_SSH_HOST=${SSH_HOST} is loopback — that runs padi DIRECTLY (no ssh), a false green. Use a non-loopback alias routing to a real sshd.`,
  );
}
// DESTRUCTIVE-ACK guard, the twin of `remotePadiSsh.test.ts`'s. This suite starts a
// previous-release padi on the host and then lets the current build TAKE IT OVER —
// it SIGTERMs a padi on `KOLU_E2E_SSH_HOST`. It works in a run-unique state root, so
// it cannot touch a production padi's socket; the ack is still required, because a
// mistyped host would spawn and reap daemons on a machine nobody offered up.
if (enabled && process.env.KOLU_E2E_SSH_DESTRUCTIVE_ACK !== "1") {
  throw new Error(
    `REFUSING: the ssh upgrade-window e2e SPAWNS and REAPS padi daemons on '${SSH_HOST}'. ` +
      `Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '${SSH_HOST}' is a DISPOSABLE test host (a pu box).`,
  );
}
const describeSsh = enabled ? describe : describe.skip;

/** Wall-clock ceiling for the whole dial, from `pin()` to `connected`. The
 *  incident's shape was ~10s per attempt forever; a bound is what makes "not a
 *  loop" a fact rather than a hope. Generous because the FIRST dial provisions the
 *  current closure into the host's Nix store (a real remote-store build), which is
 *  minutes on a cold box and seconds on a warm one — the assertion that actually
 *  discriminates a loop is the campaign count in step 6, not this ceiling. */
const CONNECT_CEILING_MS = 300_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Ceiling on ONE `sshRun`. These are small shell probes against a live box, so
 *  seconds is the honest scale; the ceiling exists because ssh does not return
 *  until every process holding the channel's stdout has exited, which turns a
 *  daemon that leaks its stdio into an UNBOUNDED wait. Without this the harness
 *  can silently eat the whole test budget and report a bare "timed out" naming
 *  nothing (it did, on the first run of this suite). Fail fast, naming the
 *  script. */
const SSH_RUN_TIMEOUT_MS = 60_000;

/** Run a command on the ssh host and return its stdout. Goes through
 *  `buildSshProbeCommand` — the same argv builder (and the same `--` sink
 *  discipline) the connector's own probes use — so this helper cannot drift from
 *  how the production path reaches the host. The script is passed as ONE token to
 *  `sh -c`, quoted by the builder. */
async function sshRun(script: string): Promise<string> {
  const { command, args } = buildSshProbeCommand(
    SSH_HOST as string,
    "sh",
    "-c",
    script,
  );
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: SSH_RUN_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (err) {
    // `killed` is how `execFile` reports its own timeout. Re-raise naming the
    // script, because "ssh hung" is useless and "ssh hung running X" is not.
    const killed = (err as { killed?: boolean }).killed === true;
    throw new Error(
      killed
        ? `ssh to ${SSH_HOST} did not return within ${SSH_RUN_TIMEOUT_MS}ms running: ${script}`
        : `ssh to ${SSH_HOST} failed running: ${script}\n${String(err)}`,
      { cause: err },
    );
  }
}

/**
 * The remote padi runtime home for a state root.
 *
 * `padiRuntimeHome` reads THIS process's `$XDG_RUNTIME_DIR`, which is the wrong
 * machine — so the digest (a pure function of the state-root string, shared by
 * both builds) is computed locally and joined to the HOST's runtime dir, read
 * over ssh. Both the resident previous daemon and the front the connector spawns
 * arrive as the same user over the same non-interactive ssh, so they resolve the
 * same `$XDG_RUNTIME_DIR` and therefore the same socket — which is exactly what
 * puts them in contention, the premise of the whole scenario.
 */
async function remotePadiHome(
  stateRoot: string,
): Promise<{ socketPath: string; gatePath: string }> {
  const xdg = await sshRun('printf %s "$XDG_RUNTIME_DIR"');
  if (xdg === "")
    throw new Error(
      `no $XDG_RUNTIME_DIR on ${SSH_HOST} — padi's rendezvous is keyed to it, so the resident daemon and the front could not be put in contention`,
    );
  const dir = `${xdg}/padi-${padiDigest(stateRoot)}`;
  return { socketPath: `${dir}/padi.sock`, gatePath: `${dir}/padi.pid` };
}

/** The pid holding a remote gate, or null when the gate is absent/empty. The gate
 *  is pid-first by contract, so the first whitespace-delimited field is the pid. */
async function remoteGatePid(gatePath: string): Promise<number | null> {
  const out = await sshRun(
    `cat ${gatePath} 2>/dev/null | head -1 | awk '{print $1}'`,
  );
  const pid = Number(out);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Is a remote pid live? `kill -0`, the same liveness question `isHolderLive`
 *  asks locally. */
async function remoteAlive(pid: number): Promise<boolean> {
  return (await sshRun(`kill -0 ${pid} 2>/dev/null && echo yes || echo no`))
    .trim()
    .endsWith("yes");
}

/**
 * Wait for the resident daemon to be up WITHOUT speaking its protocol — the
 * socket ACCEPTS and the gate names a LIVE holder. Nothing else is readable
 * across a protocol epoch: a handshake against a previous-release daemon can
 * never complete, so a probe that spoke would fail at the FIXTURE, before a
 * single assertion ran. (The local upgrade-window e2e reaches the same
 * conclusion for the same reason.)
 */
async function waitForResidentDaemon(
  socketPath: string,
  gatePath: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = "never probed";
  while (Date.now() < deadline) {
    // `test -S` is the accept-free half; a connect that returns immediately is
    // the other. `nc`-free: node is not on the far side, so this uses the shell's
    // own socket test plus the gate, which together are "it is up and it is ours".
    const up = await sshRun(
      `test -S ${socketPath} && echo sock || echo nosock`,
    );
    if (up.endsWith("sock") && !up.endsWith("nosock")) {
      const pid = await remoteGatePid(gatePath);
      if (pid !== null && (await remoteAlive(pid))) return pid;
      last = `socket present, gate=${pid ?? "absent"}`;
    } else {
      last = "no socket yet";
    }
    await sleep(500);
  }
  throw new Error(
    `the previous-release padi never came up at ${socketPath} on ${SSH_HOST} (${last})`,
  );
}

describeSsh(
  "the remote upgrade window — a previous-epoch padi behind real ssh",
  () => {
    const sessions: { destroy(): void }[] = [];
    /** Every state-root this suite planted, reaped in `afterAll` even on failure. */
    const plantedStateRoots: string[] = [];

    afterAll(async () => {
      for (const s of sessions.splice(0)) s.destroy();
      for (const stateRoot of plantedStateRoots.splice(0)) {
        try {
          // Reap the WHOLE footprint this suite left on the box, not just the
          // state root: the daemon still holding the gate (whichever epoch won),
          // its kaval, the resident daemon's log, and the digest-keyed runtime
          // dir. A run-unique digest means every one of these is provably ours,
          // so a disposable box does not accumulate a padi per run.
          const { gatePath, socketPath } = await remotePadiHome(stateRoot);
          const pid = await remoteGatePid(gatePath);
          if (pid !== null)
            await sshRun(`kill -TERM ${pid} 2>/dev/null || true`);
          const runtimeDir = socketPath.replace(/\/padi\.sock$/, "");
          const kavalDir = runtimeDir.replace(/\/padi-/, "/kaval-");
          await sshRun(
            `rm -rf ${stateRoot} ${stateRoot}.previous.log ${runtimeDir} ${kavalDir}`,
          );
        } catch (err) {
          // Teardown of a disposable box's scratch dir. Say so loudly rather than
          // masking the test's own verdict with a cleanup throw.
          console.warn(
            `[upgrade-window] teardown of ${stateRoot} failed: ${err}`,
          );
        }
      }
    });

    it("takes over a resident previous-release padi exactly once and converges in one campaign", async () => {
      // ── 0) The window must be REAL ────────────────────────────────────────
      // A previous store path equal to the current one would collapse the
      // mixed-version window into a same-version recycle — the failure mode that
      // green-washed an earlier landing of the local arm.
      assertPreviousReleaseWindow({
        ref: PREVIOUS_PADI_REF as string,
        previousStore: PREVIOUS_PADI_STORE as string,
        currentStore: CURRENT_PADI_STORE as string,
      });
      console.log(
        `[upgrade-window] previous release ${PREVIOUS_PADI_REF} = ${PREVIOUS_PADI_STORE}`,
      );
      console.log(
        `[upgrade-window] current build      = ${CURRENT_PADI_STORE}`,
      );

      // Run-unique state root: the socket is keyed to its digest, so this suite
      // can never contend with a real padi on the host — only with the daemon it
      // plants itself.
      const stateRoot = `/tmp/kolu-e2e-upgrade-${randomUUID()}`;
      plantedStateRoots.push(stateRoot);
      const { socketPath, gatePath } = await remotePadiHome(stateRoot);
      console.log(`[upgrade-window] remote state-root ${stateRoot}`);
      console.log(`[upgrade-window] remote rendezvous ${socketPath}`);

      const previousBin = `${PREVIOUS_PADI_STORE}/bin/padi`;
      expect(
        await sshRun(`test -x ${previousBin} && echo yes || echo no`),
      ).toBe("yes");

      // ── 1) Plant the previous-epoch daemon ON the host ────────────────────
      // Detached (`nohup`, stdio redirected) so it OUTLIVES this ssh command and
      // is genuinely RESIDENT when the dial arrives — a daemon that died with its
      // launching ssh session would leave nothing to take over.
      //
      // The detach is LOAD-BEARING and its exact shape matters. `ssh` does not
      // return until nothing holds its channel's stdout — so a backgrounded remote
      // daemon must be severed from that channel completely, or this call blocks
      // for the whole test budget (it did, on the first run of this suite):
      //   - `setsid`  — a new session, so the daemon is not in the ssh command's
      //                 process group and outlives the login shell;
      //   - `> log 2>&1 < /dev/null` — the daemon's OWN fds go to a file;
      //   - `{ … & } > /dev/null 2>&1` — and the backgrounding SUBSHELL's fds are
      //                 closed too, which is the half that `nohup` alone misses.
      // `KOLU_KAVAL_SPAWN=detached` keeps padi's kaval out of the channel as well
      // — the same var the local upgrade-window e2e sets in its `padiEnv()`.
      // `SSH_RUN_TIMEOUT_MS` is the backstop if a future build regresses any of
      // this: a hang must fail loudly, not silently spend the budget.
      const residentLog = `${stateRoot}.previous.log`;
      await sshRun(
        `mkdir -p ${stateRoot}; ` +
          `{ setsid env KOLU_KAVAL_SPAWN=detached ${previousBin} ` +
          `--state-root ${stateRoot} > ${residentLog} 2>&1 < /dev/null & } ` +
          `> /dev/null 2>&1; echo started`,
      );
      const oldPid = await waitForResidentDaemon(socketPath, gatePath, 120_000);
      console.log(
        `[upgrade-window] RESIDENT previous-release padi is up — pid ${oldPid} holds ${gatePath}`,
      );

      // ── 2) Dial with the CURRENT build, through the production stack ───────
      // Every state frame is retained: the phase walk proves "one campaign", and
      // the `remote`-tagged log lines are the FRONT's own stderr, forwarded by the
      // connector — which is where the convergence narrates itself.
      const states: SessionState<SshProv>[] = [];
      const remoteLines = new Set<string>();
      const localLines: string[] = [];

      const session = makeSession<AgentClient, SshProv>({
        initialConnection: "probing",
        connectOnce: sshConnector({
          surface: { ...padiSurfaceSibling, group: padiDaemonGroup },
          host: SSH_HOST as string,
          binary: "padi",
          // `buildAgentCommand` already runs the binary as `padi --stdio` and
          // appends these AFTER it — so this must NOT re-pass `--stdio`. The
          // state root is the ONE thing that puts this front in contention with
          // the daemon planted above; it travels on the command line because ssh
          // exec carries no env channel (the production binder does the same).
          extraArgs: ["--state-root", stateRoot],
          localEnv: {},
          resolveDrvPath: async () =>
            directAgentDerivation(PADI_DRV as string, TEST_BINARY_CACHE),
        }),
        log: collectLogger((l) => {
          localLines.push(l);
          console.log(`[host] ${l}`);
        }),
      });
      sessions.push(session);

      const unsubscribe = session.onState((s) => {
        states.push(s);
        for (const entry of s.log)
          if (entry.source === "remote") remoteLines.add(entry.line);
      });

      const startedAt = Date.now();
      await session.pin();
      session.markConnected();
      const dispatch: SurfaceDispatch | undefined = session.currentDispatch?.();
      if (dispatch === undefined)
        throw new Error("the pinned ssh session exposed no dispatch");
      const combined: PadiDaemonClient = padiClientOver(dispatch);

      // The RPC that proves the link is not merely open but SPEAKING — the thing
      // the incident's link could never do.
      const hello = await Effect.runPromise(
        combined.control.surface.core.hello(),
      );
      const connectedMs = Date.now() - startedAt;
      unsubscribe();

      expect(
        isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION),
      ).toBe(true);
      expect(hello.stateRoot).toBe(stateRoot);
      console.log(
        `[upgrade-window] CONNECTED in ${connectedMs}ms — padiSurface=${hello.surfaceVersion} stateRoot=${hello.stateRoot}`,
      );

      const narration = [...remoteLines];
      for (const line of narration) console.log(`[front] ${line}`);

      // ── 3) ONE TAKEOVER ───────────────────────────────────────────────────
      // The front classified the resident daemon as unspeakable and stopped it.
      // Counting is the point: a loop would narrate this repeatedly.
      const tookOver = narration.filter((l) => l.includes("TOOK OVER"));
      expect(
        tookOver.length,
        `expected EXACTLY ONE takeover of the previous-epoch daemon; the front narrated ${tookOver.length}:\n${tookOver.join("\n")}`,
      ).toBe(1);
      const takeover = tookOver[0] as string;
      // The classification the remote arm previously could not even reach: the
      // peer accepted and then said nothing, which is what a previous-epoch daemon
      // waiting for a greeting we no longer speak looks like.
      expect(takeover).toContain(String(oldPid));
      expect(takeover).toMatch(/SIGTERM|SIGKILL/);
      expect(
        narration.some((l) =>
          l.includes("speaks a protocol epoch this supervisor cannot decode"),
        ),
        `the front never named the epoch classification — an unspeakable peer must be classified, not merely dropped:\n${narration.join("\n")}`,
      ).toBe(true);
      // The takeover was GRACEFUL: the previous daemon's own shutdown ran, which
      // is what lets the replacement seed its session from disk instead of losing
      // it. This is the "sessions survive via the shutdown capture" half of F4.
      expect(takeover).toContain("its own shutdown ran");

      // ── 4) ONE CLEAN CONVERGE ─────────────────────────────────────────────
      const relayed = narration.filter((l) =>
        l.includes("converged — relaying"),
      );
      expect(
        relayed.length,
        `expected EXACTLY ONE converge-then-relay; got ${relayed.length}:\n${relayed.join("\n")}`,
      ).toBe(1);
      expect(relayed[0]).toContain('"outcome":"recycled"');
      expect(relayed[0]).toContain('"anomaly":null');
      // …and the front never refused. A `refused` banner is the fail-fast arm; it
      // is correct behaviour, but it is NOT convergence, and a run that refused
      // would leave the stale daemon standing.
      expect(
        narration.some((l) => l.includes("refusing to relay")),
        `the front REFUSED to relay — the upgrade did not complete hands-off:\n${narration.join("\n")}`,
      ).toBe(false);

      // ── 5) THE PID FACTS, read on the host ────────────────────────────────
      // The narration says it happened; the host's own pid table proves it.
      expect(
        await remoteAlive(oldPid),
        `the previous-release padi (pid ${oldPid}) is STILL ALIVE — it was not taken over`,
      ).toBe(false);
      const newPid = await remoteGatePid(gatePath);
      expect(newPid, "no pid holds the gate after convergence").not.toBeNull();
      expect(newPid).not.toBe(oldPid);
      expect(await remoteAlive(newPid as number)).toBe(true);
      console.log(
        `[upgrade-window] padi TAKEN OVER on ${SSH_HOST} — ${oldPid} (previous epoch) → ${newPid} (this build)`,
      );

      // ── 6) NOT A LOOP — the incident's signature, asserted absent ─────────
      // The gist's shape was: connecting → dead at ~10s → connecting → dead …
      // for ever, because an admit failure classified `"network"` never counted
      // toward the give-up budget. Each of those attempts is a fresh campaign, so
      // the campaign counter is the sharpest discriminator available.
      const phases = states.map((s) => s.phase);
      const campaigns = new Set(states.map((s) => s.campaignEpoch));
      expect(
        phases.includes("failed"),
        `the session went terminal:\n${JSON.stringify(states.filter((s) => s.phase === "failed"))}`,
      ).toBe(false);
      expect(
        campaigns.size,
        `expected ONE campaign (at most one reconnect); saw ${campaigns.size} — campaigns ${[...campaigns].join(",")} over phases ${phases.join("→")}`,
      ).toBeLessThanOrEqual(2);
      const drops = phases.filter((p) => p === "disconnected");
      expect(
        drops.length,
        `the link dropped ${drops.length} times before connecting — the incident's 10s-per-attempt loop:\n${phases.join("→")}`,
      ).toBeLessThanOrEqual(1);
      expect(
        connectedMs,
        `took ${connectedMs}ms to reach connected — a bounded upgrade must not sit in a retry loop`,
      ).toBeLessThan(CONNECT_CEILING_MS);
      console.log(
        `[upgrade-window] one campaign, no terminal verdict — phases ${phases.join("→")} in ${connectedMs}ms`,
      );
    }, 600_000);
  },
);
