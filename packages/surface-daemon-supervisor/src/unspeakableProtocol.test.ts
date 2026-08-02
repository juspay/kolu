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
 *  2. REFUSE (padi / `drain-newer-else-refuse`). Corroborated, the survivor is
 *     left standing and degraded, with a typed `unspeakable-protocol` cause and
 *     an operator-facing message that says why drain could not run.
 *  3. RECYCLE (kaval). Corroborated, the verified gate holder is SIGTERM'd and a
 *     fresh daemon is spawned — the path the ordinary adopt-or-recycle bind
 *     cannot take, because an unspeakable peer never proves a skew to a
 *     `connect` that cannot speak to it either.
 *  4. A FOREIGN SQUATTER IS UNTOUCHED. The gate-less-squatter recovery keeps its
 *     own refusal (`SocketSquatterForeignError`); nothing here reaches it.
 *  5. BOTH TRIGGERS EARN THE SAME VERDICT. Laws 1–3 above are driven by an
 *     injected `undecodable-frame` fact; the `silence` block near the bottom
 *     drives 1 and 3 again through the REAL dial against a peer that accepts and
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
  outcomeAdopted,
  outcomeAnomaly,
} from "./convergence/converge.ts";
import type { ConvergencePolicy } from "./convergence/policy.ts";
import {
  isUnspeakablePeerError,
  isUnspeakableProtocolError,
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

describe("unspeakable-protocol — the refuse disposition (padi)", () => {
  it("leaves a verified survivor standing, with a typed cause and an operator message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sds-unspeakable-refuse-"));
    tmpDirs.push(dir);
    const socketPath = join(dir, "d.sock");
    const gatePath = join(dir, "d.pid");
    // Our gate, naming a live pid (this process), over an accepting socket:
    // both attestations the escalation requires. Nothing is ever killed on this
    // path, which is why using our own pid is safe here.
    await listenSilently(socketPath);
    writeFileSync(gatePath, `${process.pid}\n`);

    const endpoint = createEndpoint<string, { v: string }>({
      hostId: "test",
      home: { dir, gatePath, socketPath },
      policy: padiPolicy,
      probe: unspeakableProbe,
      driver: {
        spawn: async () => {
          throw new Error("a refuse policy must never spawn over the survivor");
        },
      },
      connect: async () => {
        throw new Error("a refuse policy must never dial the survivor's soul");
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
      pid: process.pid,
    });
    // …and the sentence itself says the thing an operator needs: the ordered
    // drain policy could not drain, so it degenerated to refuse.
    expect(anomaly.detail).toContain("drain verb is therefore unreachable");
    expect(anomaly.detail).toContain("REFUSE");
    expect(anomaly.detail).toContain("never killed");
    // The survivor is left standing: nothing was held, nothing was spawned.
    expect(endpoint.current()).toBeUndefined();
  });
});

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
