/**
 * Yesterday's kaval meets today's padi — the two arms that survive PLAN D6,
 * driven through padi's OWN convergence probe (`probeKavalForConvergence`).
 *
 * The file this replaces asked what a kaval WITHOUT the frozen control-core
 * fragment does. That peer no longer exists as a *previous release*: a kaval
 * that predates the frozen fragment also predates this protocol EPOCH, so its
 * first frame does not decode and a dial never reaches route resolution. The
 * pre-fragment redial that used to catch it is deleted (padi-B1 §3), and its
 * in-epoch successor — a peer that speaks this wire and serves a narrower member
 * set — is pinned where it belongs, at `ptyHost/connect.test.ts`.
 *
 * What the UPGRADE WINDOW still has to answer is the pair below, and they are
 * deliberately the two SIDES of the epoch boundary:
 *
 *   1. **cross-epoch** — a survivor at our rendezvous we cannot speak to is the
 *      supervisor's `UnspeakableProtocolError` (D6/#3, #9), raised at whichever
 *      of its two bounded triggers the peer fires: bytes we cannot parse, or
 *      total silence past the dial's silence bound. A real previous release
 *      fires the second one — it waits for a greeting in a protocol we no longer
 *      speak — so both are pinned here. It is never a null (which would read as
 *      "nobody home" and let a fresh daemon race a live one for the socket) and
 *      never a silently-degraded identity (which is what the deleted fallback
 *      produced). The corroborated verdict + its per-policy disposition — kaval
 *      RECYCLES — belongs to the endpoint, and is pinned by the supervisor's
 *      `unspeakableProtocol.test.ts` and by `previousRelease.e2e`. Here we pin
 *      the FACT padi's own probe raises, because padi is what hands that probe
 *      to `createEndpoint`.
 *
 *   2. **in-epoch** — a survivor that speaks this wire but was built from a
 *      different tree is a BUILD mismatch, and kaval's non-drainable policy
 *      refuses to act on it: recycling would cost live PTYs, so the kit reports
 *      the mismatch and the human decides. This is the arm that keeps working
 *      normally through an ordinary upgrade, and it is the one the epoch break
 *      must not have broken.
 */

import { mkdtempSync } from "node:fs";
import { Effect } from "effect";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { daemonBuild } from "@kolu/surface-daemon";
import { plantYesterdayDaemon } from "@kolu/surface-daemon/upgrade-window.testlib";
import {
  decide,
  instanceKeyFromStartedAt,
  isUnspeakablePeerError,
  isUnspeakableProtocolError,
} from "@kolu/surface-daemon-supervisor";
import {
  createInProcessPtyHost,
  PTY_HOST_CONTRACT_VERSION,
  serveKavalDaemonSurface,
  servePtyHostOverUnixSocket,
} from "kaval";
import { expect, it } from "vitest";
import { probeKavalForConvergence } from "../ptyHost/connect.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { padiYesterdayDaemonOptions } from "./yesterdayDaemon.fixture.testlib.ts";

/** kaval's declared policy, as `ptyHost/index.ts` spells it: non-drainable, so a
 *  wire-incompatible survivor is recycled and a same-contract build change only
 *  nudges the human. Restated here (not imported — it is a private detail of the
 *  composition root) so this file drives the SAME two arms production does. */
const kavalPolicy = {
  capability: "not-drainable",
  baked: {
    contractVersion: PTY_HOST_CONTRACT_VERSION,
    build: daemonBuild("current-kaval-build"),
  },
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
} as const;

describeDaemon("yesterday kaval at our rendezvous", () => {
  it("PREVIOUS EPOCH: an undecodable first frame is classified at the decode, never as absence", async () => {
    // The socket is planted by hand rather than by the fixture's own listener
    // because the fact under test is what the peer SAYS: this one answers
    // promptly, in a framing this build cannot parse. (The fixture's own
    // listener accepts and stays MUTE — the other trigger, exercised by the
    // test right below.) The classification must cost the caller one
    // round-trip, not a deadline: that is review #9's point.
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: false }),
    );
    let server: Server | undefined;
    try {
      server = createServer((socket) => {
        socket.on("error", () => {
          // The probe destroys its side on classification; a reset here is
          // expected, not a fixture failure.
        });
        // A previous protocol epoch's greeting: well-formed bytes, wrong
        // language. `RpcSerialization.ndjson` — Effect's own parser, which is
        // what the probe's tap runs — cannot decode it.
        socket.write("EVENT: hello\ndata: {oh no}\n\n");
      });
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(yesterday.socketPath, () => resolve());
      });

      const raised = await Effect.runPromise(
        probeKavalForConvergence(yesterday.socketPath),
      ).then(
        (probe) => {
          throw new Error(
            `probe resolved ${probe === null ? "null" : "an identity"} against an undecodable peer`,
          );
        },
        (error: unknown) => error,
      );

      // The TRANSPORT fact, with its evidence as fields.
      expect(isUnspeakableProtocolError(raised)).toBe(true);
      if (!isUnspeakableProtocolError(raised)) throw new Error("unreachable");
      expect(raised.socketPath).toBe(yesterday.socketPath);
      // JSON-quoted, so the peer's own newlines cannot reshape an operator log
      // line — and the excerpt really is the peer's bytes, not a placeholder.
      expect(raised.evidence.trigger).toBe("undecodable-frame");
      if (raised.evidence.trigger !== "undecodable-frame") {
        throw new Error("unreachable");
      }
      expect(raised.evidence.frame).toContain("EVENT: hello");
      expect(raised.evidence.frame.startsWith('"')).toBe(true);

      // NOT the corroborated verdict: only the endpoint, which owns the gate and
      // verifies the holder pid, may mint that — and only that one may buy a
      // SIGTERM. A dial-path fact that narrowed here would let any stranger on
      // our socket be killed.
      expect(isUnspeakablePeerError(raised)).toBe(false);
    } finally {
      server?.close();
      await yesterday.dispose();
    }
  });

  it("PREVIOUS EPOCH, SILENT: a peer that accepts and never answers is classified at the silence bound", async () => {
    // The trigger a REAL previous release actually fires, and the one the first
    // cut of this observation missed. An old kaval's oRPC server does not greet
    // us: it waits for a client hello in a protocol we no longer speak, reads
    // our ndjson without recognising a single frame of it, and says nothing.
    // There is no undecodable FIRST FRAME anywhere in that exchange — measured
    // against the real binary in `previousRelease.e2e`, where the connection
    // instead died of the RPC protocol's ping timeout and the whole boot
    // degraded to probe-failed ⇒ refuse, leaving the old daemon holding the
    // rendezvous. The fixture's own listener is exactly that peer.
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: true }),
    );
    try {
      const raised = await Effect.runPromise(
        probeKavalForConvergence(yesterday.socketPath),
      ).then(
        (probe) => {
          probe?.dispose();
          throw new Error(
            `probe resolved ${probe === null ? "null" : "an identity"} against a silent peer`,
          );
        },
        (error: unknown) => error,
      );

      expect(isUnspeakableProtocolError(raised)).toBe(true);
      if (!isUnspeakableProtocolError(raised)) throw new Error("unreachable");
      expect(raised.socketPath).toBe(yesterday.socketPath);
      // Same verdict as an undecodable frame, different evidence — as DATA, so
      // the disposition never has to read a sentence to know what happened.
      expect(raised.evidence.trigger).toBe("silence");

      // Still ONLY the transport fact. Silence is the cheapest thing a stranger
      // can produce, so the corroboration (our gate, our verified pid) stays the
      // endpoint's job — it is what buys the SIGTERM, and it is pinned with the
      // recycle it earns in the supervisor's `unspeakableProtocol.test.ts`.
      expect(isUnspeakablePeerError(raised)).toBe(false);
    } finally {
      await yesterday.dispose();
    }
  }, 30_000);

  it("SAME EPOCH, different build: the not-drainable policy nudges the human", async () => {
    const yesterday = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({ withSocket: false }),
    );
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "yesterday-kaval-rc-")),
      lifetime: { kind: "forever" },
    });
    // The whole kaval daemon surface — the frozen control core included. Within
    // this epoch that fragment is REQUIRED, so serving it is what makes this
    // survivor "yesterday's build" rather than "yesterday's protocol".
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/kaval-yesterday",
    });
    const listener = await servePtyHostOverUnixSocket({
      socketPath: yesterday.socketPath,
      served: { group: runtime.group, handlers: runtime.handlers },
      log: silentLog,
    });
    try {
      const probe = await Effect.runPromise(
        probeKavalForConvergence(yesterday.socketPath),
      );
      expect(probe).not.toBeNull();
      if (probe === null) throw new Error("a speakable peer probed to null");
      // Identity comes from the frozen hello only. This test process bakes no
      // KAVAL_BUILD_ID, so the honest reading of its build is "off-nix" — which
      // is precisely a build the current bake does not match.
      expect(probe.identity).toEqual({
        contractVersion: PTY_HOST_CONTRACT_VERSION,
        build: { kind: "off-nix" },
      });
      expect(probe.instanceKey).toEqual(
        instanceKeyFromStartedAt(ptyHost.boot.startedAt),
      );

      const decision = decide(kavalPolicy, probe.identity);
      // Contract COMPATIBLE, build different ⇒ report, do not act: kaval's PTYs
      // outrank an update nudge.
      expect(decision).toMatchObject({
        kind: "report-mismatch",
        running: {
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          build: { kind: "off-nix" },
        },
      });
      probe.dispose();
    } finally {
      listener.close();
      await runtime.close();
      await ptyHost.close();
      await yesterday.dispose();
    }
  });
});
