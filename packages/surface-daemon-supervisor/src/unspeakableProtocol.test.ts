/**
 * The THIRD convergence observation — `unspeakable-protocol` (PLAN D6 / review
 * finding #3), end to end through the REAL endpoint and the REAL fold.
 *
 * The fact under test is the protocol-epoch flag day: a daemon built before the
 * Effect-4 wire break cannot be asked anything, because version negotiation
 * happens inside the protocol that was replaced. The supervisor must therefore
 * be able to say "our daemon is there and it does not speak our protocol" — and
 * must NOT be able to say it about anyone else's process.
 *
 * The laws, one per test:
 *
 *  1. CORROBORATION IS REQUIRED. An unspeakable peer at a rendezvous with no
 *     gate of ours is an ordinary `probe-failed` refusal — never the new
 *     observation, never a licence to touch anything.
 *  2. TAKEOVER, FOR EVERY POLICY (PLAN D6 / Wave A). Corroborated, the verified
 *     gate holder is stopped and a daemon of this epoch is spawned in its place
 *     — under padi's ordered `drain-newer-else-refuse` exactly as under kaval's
 *     `recycle`. This is the path the ordinary adopt-or-recycle bind cannot
 *     take, because an unspeakable peer never proves a skew to a `connect` that
 *     cannot speak to it either. (padi's old REFUSE is gone: it reasoned from
 *     "the drain verb is unreachable" to "leave it standing", which meant a
 *     cross-epoch upgrade could never converge without a human.)
 *  3. A HOLDER WE DID NOT CLASSIFY IS NEVER TOUCHED. If the gate stops naming
 *     the classified pid between the observation and the kill, nothing is
 *     signalled and the pass refuses with the typed `unspeakable-protocol`
 *     cause.
 *  4. A FOREIGN SQUATTER IS UNTOUCHED. The gate-less-squatter recovery keeps its
 *     own refusal (`SocketSquatterForeignError`); nothing here reaches it.
 *  5. A MERELY SLOW DAEMON OF THIS EPOCH IS NEVER TAKEN OVER. The trigger bounds
 *     sit above the protocol's own liveness floor, so slowness still yields an
 *     IDENTITY — an ordinary adopt, with the survivor alive at the end.
 *  6. BOTH TRIGGERS EARN THE SAME VERDICT. Laws 1–3 above are driven by an
 *     injected `undecodable-frame` fact; the `silence` block near the bottom
 *     drives 1 and 2 again through the REAL dial against a peer that accepts and
 *     never speaks — the shape a real previous release actually presents.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import {
  type ConvergenceIdentity,
  daemonBuild,
  type Logger,
} from "@kolu/surface-daemon";
import { plantYesterdayDaemon } from "@kolu/surface-daemon/upgrade-window.testlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  converge,
  instanceKeyFromStartedAt,
  outcomeAdopted,
  outcomeAnomaly,
} from "./convergence/converge.ts";
import type { ConvergencePolicy } from "./convergence/policy.ts";
import {
  isUnspeakablePeerError,
  isUnspeakableProtocolError,
  UnspeakablePeerError,
  UnspeakableProtocolError,
} from "./convergence/unspeakable.ts";
import { createEndpointForKoluTest as createEndpoint } from "./createEndpoint.kolu.testlib.ts";
import type { EndpointStatus } from "./endpoint.ts";
import { probeDaemonIdentity } from "./probeDaemonIdentity.ts";

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const id = (contractVersion: string, buildId: string): ConvergenceIdentity => ({
  contractVersion,
  build: daemonBuild(buildId),
});

const padiPolicy: ConvergencePolicy<"drainable"> = {
  capability: "drainable",
  baked: id("2.0", "B"),
  onContractSkew: { kind: "drain-newer-else-refuse" },
  onBuildMismatch: { kind: "drain-and-replace" },
  drainBudget: { maxAttempts: 2, onGiveUp: "adopt-stale" },
};

const kavalPolicy: ConvergencePolicy<"not-drainable"> = {
  capability: "not-drainable",
  baked: id("2.0", "B"),
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
};

const tmpDirs: string[] = [];
const servers: Server[] = [];
const fixtures: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    (
      s as Server & { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    s.close();
  }
  for (const f of fixtures.splice(0)) await f.dispose();
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

/** Bind an accepting listener that reads everything and answers nothing.
 *
 *  For the injected-probe tests below, what matters is only that the socket is
 *  ACCEPTING — that is half of the endpoint's holder verification. For the
 *  real-dial tests at the bottom this listener IS the peer under test: mute is
 *  precisely what a daemon of another epoch is to us. */
async function listenSilently(socketPath: string): Promise<Server> {
  const server = createServer((sock) => {
    sock.on("error", () => {});
    // Read and discard: a peer of another epoch parses our frames and answers
    // none of them, and an unread socket would never see its client hang up.
    sock.resume();
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

/** The probe every test here injects: it dials nothing and raises exactly what
 *  the real dial path raises at an explicit first-frame decode failure. */
const unspeakableProbe = (socketPath: string): Promise<never> =>
  Promise.reject(
    new UnspeakableProtocolError({
      socketPath,
      evidence: {
        trigger: "undecodable-frame",
        frame: JSON.stringify("<<< previous epoch >>>\n"),
      },
    }),
  );

/** The REAL dial, used by the silence arms below. Those two tests inject nothing:
 *  a peer that accepts and says nothing is a shape a fixture can produce exactly,
 *  so the trigger, the corroboration and the disposition are all proven by the
 *  production code path rather than by a hand-thrown error. */
const realProbe = probeDaemonIdentity({ capability: "not-drainable" });

describe("unspeakable-protocol — corroboration", () => {
  it("is NOT raised without a gate of ours: it stays probe-failed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sds-unspeakable-nogate-"));
    tmpDirs.push(dir);
    const socketPath = join(dir, "d.sock");
    const gatePath = join(dir, "d.pid");
    // Accepting socket, NO gate file — exactly the gate-less squatter shape.
    await listenSilently(socketPath);

    const statuses: EndpointStatus<{ v: string }>[] = [];
    const endpoint = createEndpoint<string, { v: string }>({
      hostId: "test",
      home: { dir, gatePath, socketPath },
      policy: padiPolicy,
      probe: unspeakableProbe,
      driver: {
        spawn: async () => {
          throw new Error("spawn must not run on an uncorroborated peer");
        },
      },
      connect: async () => {
        throw new Error("connect must not run on an uncorroborated peer");
      },
      log: silent,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectAttempts: 1,
      adoptConnectRetryMs: 1,
    });

    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    const anomaly = outcomeAnomaly(out);
    expect(anomaly?.kind).toBe("unconverged");
    if (anomaly?.kind !== "unconverged") throw new Error("unreachable");
    // The narrowing did NOT fire — `probe-failed` is not widened, and the
    // gate-less squatter path keeps its own (untouched) disposition.
    expect(anomaly.cause.kind).toBe("probe-failed");
  });
});

describeDaemon("unspeakable-protocol — the TAKEOVER disposition (padi)", () => {
  it("stops the verified gate holder and spawns this build's daemon in its place", async () => {
    // A REAL child process holds the gate, because this disposition really does
    // stop it — the one arm that cannot be proven against a fake pid. This is
    // the arm that used to REFUSE: padi's ordered `drain-newer-else-refuse`
    // reasoned from "the drain verb is unreachable" to "leave it standing",
    // which left a cross-epoch upgrade permanently unconverged.
    const survivor = await plantYesterdayDaemon({
      gateFile: "daemon.pid",
      socketFile: "daemon.sock",
      assertSpawnAllowed: assertDaemonSpawnAllowed,
      plantState: () => {},
      withSocket: true,
    });
    fixtures.push({ dispose: survivor.dispose });
    if (survivor.process.kind !== "live") {
      throw new Error("expected a live survivor process");
    }
    if (survivor.listener.kind !== "listening") {
      throw new Error("expected a listening survivor socket");
    }
    const survivorPid = survivor.process.pid;
    const survivorServer = survivor.listener.server;

    let spawned = 0;
    const statuses: EndpointStatus<{ v: string }>[] = [];
    const endpoint = createEndpoint<string, { v: string }>({
      hostId: "test",
      home: {
        dir: survivor.dir,
        gatePath: survivor.gatePath,
        socketPath: survivor.socketPath,
      },
      policy: padiPolicy,
      probe: unspeakableProbe,
      driver: {
        spawn: async () => {
          spawned += 1;
          // The stopped daemon's socket goes with it; the "fresh daemon" binds a
          // new one at the same rendezvous.
          survivorServer.close();
          await listenSilently(survivor.socketPath);
        },
      },
      connect: async () => ({
        client: "fresh",
        identity: { v: "2.0" },
        startedAt: 7,
        dispose: () => {},
        onClose: () => {},
      }),
      log: silent,
      onStatus: (_h, s) => statuses.push(s),
      socketReadyMs: 2_000,
      socketPollMs: 5,
      adoptConnectAttempts: 1,
      adoptConnectRetryMs: 1,
    });

    const out = await converge(endpoint);
    // The same outcome kaval's arm reports, because it is the same act: the
    // holder was replaced, not adopted.
    expect(out.kind).toBe("recycled");
    expect(outcomeAnomaly(out)).toBeNull();
    expect(spawned).toBe(1);
    expect(statuses.at(-1)?.state).toBe("connected");
    expect(endpoint.current()).toBeDefined();
    // Mutate-to-prove: the survivor really is gone.
    expect(() => process.kill(survivorPid, 0)).toThrow();
  }, 40_000);

  it("NEVER touches a holder it did not classify — the gate changed under us", async () => {
    // The irreducible window: between the probe that classified pid P and the
    // signal, our gate came to name someone else. That someone was never
    // observed — it may be a healthy daemon of this epoch that replaced the old
    // one — so nothing is signalled and the pass refuses instead.
    const dir = mkdtempSync(join(tmpdir(), "sds-unspeakable-changed-"));
    tmpDirs.push(dir);
    const socketPath = join(dir, "d.sock");
    const gatePath = join(dir, "d.pid");
    await listenSilently(socketPath);
    // The gate names THIS process (live, over a serving socket) — a holder the
    // identity law accepts. The corroborated error below names a different one.
    writeFileSync(gatePath, `${process.pid}\n`);

    const classifiedPid = 1; // never this test process
    const endpoint = createEndpoint<string, { v: string }>({
      hostId: "test",
      home: { dir, gatePath, socketPath },
      policy: padiPolicy,
      // A pre-corroborated peer error: the endpoint's own corroboration passes
      // it straight through, so what is under test is purely the re-attestation
      // the takeover performs immediately before the kill.
      probe: (path) =>
        Promise.reject(
          new UnspeakablePeerError({
            socketPath: path,
            gatePath,
            pid: classifiedPid,
            evidence: { trigger: "silence", silentForMs: 8_000 },
          }),
        ),
      driver: {
        spawn: async () => {
          throw new Error("nothing may be spawned over an unclassified holder");
        },
      },
      connect: async () => {
        throw new Error("nothing may be dialed over an unclassified holder");
      },
      log: silent,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectAttempts: 1,
      adoptConnectRetryMs: 1,
    });

    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAdopted(out)).toBe(false);
    const anomaly = outcomeAnomaly(out);
    if (anomaly?.kind !== "unconverged") {
      throw new Error(`expected unconverged, got ${anomaly?.kind}`);
    }
    // Evidence as DATA — a UI never parses the sentence.
    expect(anomaly.cause).toEqual({
      kind: "unspeakable-protocol",
      socketPath,
      gatePath,
      pid: classifiedPid,
    });
    expect(anomaly.detail).toContain("NOTHING was signalled");
    expect(anomaly.detail).toContain(String(process.pid));
    expect(endpoint.current()).toBeUndefined();
    // And this process — the holder we never classified — is obviously still here.
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });
});

describeDaemon(
  "unspeakable-protocol — what the takeover must NOT reach",
  () => {
    it("a merely SLOW daemon of this epoch is adopted, never stopped", async () => {
      // The safety the unconditional takeover rests on. Reaching `enactUnspeakable`
      // requires the corroborated peer error and nothing else, and the dial can
      // only raise it past a bound that sits ABOVE the protocol's own liveness
      // floor — a peer of this epoch answers pings beneath its handlers, so
      // slowness always still yields an IDENTITY. (That bound is pinned at the
      // dial itself, in `probeDaemonIdentity.test.ts`, with a hello that answers
      // only at 6 s.) Here we pin the consequence at the DISPOSITION seam: an
      // identity — however late it arrives — folds through `decide`, and the live
      // survivor is alive at the end.
      const survivor = await plantYesterdayDaemon({
        gateFile: "daemon.pid",
        socketFile: "daemon.sock",
        assertSpawnAllowed: assertDaemonSpawnAllowed,
        plantState: () => {},
        withSocket: true,
      });
      fixtures.push({ dispose: survivor.dispose });
      if (survivor.process.kind !== "live") {
        throw new Error("expected a live survivor process");
      }
      const survivorPid = survivor.process.pid;

      let probes = 0;
      const endpoint = createEndpoint<string, { v: string }>({
        hostId: "test",
        home: {
          dir: survivor.dir,
          gatePath: survivor.gatePath,
          socketPath: survivor.socketPath,
        },
        policy: padiPolicy,
        probe: async () => {
          probes += 1;
          // Slow — but it ANSWERS, which is the whole difference.
          await new Promise((r) => setTimeout(r, 250));
          return {
            capability: "drainable" as const,
            identity: padiPolicy.baked,
            instanceKey: instanceKeyFromStartedAt(7),
            fireDrain: async () => {},
            awaitExit: async () => {},
            drainCeilingMs: 1_000,
            dispose: () => {},
          };
        },
        driver: {
          spawn: async () => {
            throw new Error(
              "a slow but speakable survivor must not be replaced",
            );
          },
        },
        connect: async () => ({
          client: "adopted",
          identity: { v: "2.0" },
          startedAt: 7,
          dispose: () => {},
          onClose: () => {},
        }),
        log: silent,
        onStatus: () => {},
        socketPollMs: 5,
        adoptConnectAttempts: 1,
        adoptConnectRetryMs: 1,
      });

      const out = await converge(endpoint);
      expect(out.kind).toBe("adopted");
      expect(outcomeAdopted(out)).toBe(true);
      expect(probes).toBeGreaterThan(0);
      // Mutate-to-prove, the other way round: the survivor is STILL THERE.
      expect(() => process.kill(survivorPid, 0)).not.toThrow();
    }, 40_000);
  },
);

describeDaemon("unspeakable-protocol — the recycle disposition (kaval)", () => {
  it("SIGTERMs the verified gate holder and spawns fresh", async () => {
    // A REAL child process holds the gate, because this disposition really does
    // kill it — the one arm that cannot be proven against a fake pid.
    const survivor = await plantYesterdayDaemon({
      gateFile: "daemon.pid",
      socketFile: "daemon.sock",
      assertSpawnAllowed: assertDaemonSpawnAllowed,
      plantState: () => {},
      withSocket: true,
    });
    fixtures.push({ dispose: survivor.dispose });
    if (survivor.process.kind !== "live") {
      throw new Error("expected a live survivor process");
    }
    if (survivor.listener.kind !== "listening") {
      throw new Error("expected a listening survivor socket");
    }
    const survivorPid = survivor.process.pid;
    const survivorServer = survivor.listener.server;

    let spawned = 0;
    const statuses: EndpointStatus<{ v: string }>[] = [];
    const endpoint = createEndpoint<string, { v: string }>({
      hostId: "test",
      home: {
        dir: survivor.dir,
        gatePath: survivor.gatePath,
        socketPath: survivor.socketPath,
      },
      policy: kavalPolicy,
      probe: unspeakableProbe,
      driver: {
        spawn: async () => {
          spawned += 1;
          // The reaped daemon's socket goes with it; the "fresh daemon" binds a
          // new one at the same rendezvous.
          survivorServer.close();
          await listenSilently(survivor.socketPath);
        },
      },
      connect: async () => ({
        client: "fresh",
        identity: { v: "2.0" },
        startedAt: 7,
        dispose: () => {},
        onClose: () => {},
      }),
      log: silent,
      onStatus: (_h, s) => statuses.push(s),
      socketReadyMs: 2_000,
      socketPollMs: 5,
      adoptConnectAttempts: 1,
      adoptConnectRetryMs: 1,
    });

    const out = await converge(endpoint);
    expect(out.kind).toBe("recycled");
    expect(spawned).toBe(1);
    expect(statuses.at(-1)?.state).toBe("connected");
    // Mutate-to-prove: the verified holder is actually gone.
    expect(() => process.kill(survivorPid, 0)).toThrow();
  });
});

/**
 * The SECOND trigger, through the REAL dial — the shape a live previous-release
 * daemon actually presents, and the one the first cut of this observation missed.
 *
 * An old-epoch daemon does not babble at us: its server waits for a greeting in
 * a protocol we no longer speak, so it accepts, takes our frames, and answers
 * nothing. There is no first frame to fail decoding, the connection dies of the
 * RPC protocol's own ping timeout ~10 s later, and — before the silence bound —
 * the whole thing degraded to `probe-failed` ⇒ refuse, leaving the survivor
 * holding the rendezvous. `previousRelease.e2e` measured exactly that.
 *
 * `plantYesterdayDaemon(withSocket)` reproduces the shape exactly: a live child
 * holding a one-field gate beside a socket that accepts and never speaks.
 */
describeDaemon(
  "unspeakable-protocol — a silent peer, through the real dial",
  () => {
    it("CORROBORATED: recycles the verified gate holder that never spoke", async () => {
      const survivor = await plantYesterdayDaemon({
        gateFile: "daemon.pid",
        socketFile: "daemon.sock",
        assertSpawnAllowed: assertDaemonSpawnAllowed,
        plantState: () => {},
        withSocket: true,
      });
      fixtures.push({ dispose: survivor.dispose });
      if (survivor.process.kind !== "live") {
        throw new Error("expected a live survivor process");
      }
      if (survivor.listener.kind !== "listening") {
        throw new Error("expected a listening survivor socket");
      }
      const survivorPid = survivor.process.pid;
      const survivorServer = survivor.listener.server;

      let spawned = 0;
      const endpoint = createEndpoint<string, { v: string }>({
        hostId: "test",
        home: {
          dir: survivor.dir,
          gatePath: survivor.gatePath,
          socketPath: survivor.socketPath,
        },
        policy: kavalPolicy,
        probe: realProbe,
        driver: {
          spawn: async () => {
            spawned += 1;
            survivorServer.close();
            await listenSilently(survivor.socketPath);
          },
        },
        connect: async () => ({
          client: "fresh",
          identity: { v: "2.0" },
          startedAt: 7,
          dispose: () => {},
          onClose: () => {},
        }),
        log: silent,
        onStatus: () => {},
        socketReadyMs: 2_000,
        socketPollMs: 5,
        adoptConnectAttempts: 1,
        adoptConnectRetryMs: 1,
      });

      const out = await converge(endpoint);
      expect(out.kind).toBe("recycled");
      expect(spawned).toBe(1);
      // Mutate-to-prove: the survivor that would have kept the rendezvous is gone.
      expect(() => process.kill(survivorPid, 0)).toThrow();
    }, 40_000);

    it("FOREIGN: a silent squatter with no gate of ours is still only probe-failed", async () => {
      // Same silence, no gate — so the corroboration fails and the disposition
      // must stay the untouched refusal. Silence is the cheapest thing in the
      // world for a stranger to produce; if it alone bought a SIGTERM, any process
      // that ever bound our path would be killable.
      const dir = mkdtempSync(join(tmpdir(), "sds-silent-foreign-"));
      tmpDirs.push(dir);
      const socketPath = join(dir, "d.sock");
      const gatePath = join(dir, "d.pid");
      await listenSilently(socketPath);

      const endpoint = createEndpoint<string, { v: string }>({
        hostId: "test",
        home: { dir, gatePath, socketPath },
        policy: kavalPolicy,
        probe: realProbe,
        driver: {
          spawn: async () => {
            throw new Error("spawn must not run on an uncorroborated peer");
          },
        },
        connect: async () => {
          throw new Error("connect must not run on an uncorroborated peer");
        },
        log: silent,
        onStatus: () => {},
        socketPollMs: 5,
        adoptConnectAttempts: 1,
        adoptConnectRetryMs: 1,
      });

      const out = await converge(endpoint);
      expect(out.kind).toBe("refused");
      const anomaly = outcomeAnomaly(out);
      if (anomaly?.kind !== "unconverged") {
        throw new Error(`expected unconverged, got ${anomaly?.kind}`);
      }
      expect(anomaly.cause.kind).toBe("probe-failed");
    }, 40_000);
  },
);

describe("unspeakable-protocol — the corroborated brand", () => {
  it("narrows only a carrier that attests every field it promises", () => {
    expect(isUnspeakablePeerError(null)).toBe(false);
    expect(
      isUnspeakablePeerError(
        new UnspeakableProtocolError({
          socketPath: "/s",
          evidence: { trigger: "undecodable-frame", frame: '"x"' },
        }),
      ),
    ).toBe(false);
    // A brand-carrier missing the two attestations must not narrow — otherwise
    // a forged "peer" error would buy a SIGTERM.
    expect(
      isUnspeakablePeerError({
        isUnspeakableProtocol: true,
        isUnspeakablePeer: true,
        socketPath: "/s",
        evidence: { trigger: "undecodable-frame", frame: '"x"' },
      }),
    ).toBe(false);
    expect(
      isUnspeakablePeerError({
        isUnspeakableProtocol: true,
        isUnspeakablePeer: true,
        socketPath: "/s",
        evidence: { trigger: "undecodable-frame", frame: '"x"' },
        gatePath: "/g",
        pid: 0,
      }),
    ).toBe(false);
    // The evidence itself is attested, not just its tag: a carrier whose arm is
    // missing the field that arm promises must not narrow to a type a consumer
    // would then dereference.
    expect(
      isUnspeakableProtocolError({
        isUnspeakableProtocol: true,
        socketPath: "/s",
        evidence: { trigger: "silence" },
      }),
    ).toBe(false);
    expect(
      isUnspeakableProtocolError({
        isUnspeakableProtocol: true,
        socketPath: "/s",
        evidence: { trigger: "who-knows" },
      }),
    ).toBe(false);
  });
});
