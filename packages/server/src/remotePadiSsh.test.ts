/**
 * The ssh-leg e2e — `padiSurface` consumed over a REAL ssh hop (W3.1's named path).
 *
 * No local shortcut satisfies W3.1: this drives the exact stack a `KOLU_PADI_HOST`
 * binding rides — `getHostSession({ binary: "padi", extraArgs: ["--stdio"] })`
 * provisions padi's closure to the host with Nix, runs `ssh <host> padi --stdio`
 * (fronting padi's durable daemon via `frontDaemonOverStdio`), and speaks the
 * combined `padiDaemonContract` over the ssh byte channel. It then handshakes the
 * frozen control core and round-trips a terminal, measures typing-echo latency over
 * the leg (the W3 reference), and proves adopt-or-respawn convergence across a drain.
 *
 * GUARDED: skipped unless the environment names a REAL non-loopback ssh host AND the
 * padi `.drv` to provision. A loopback host (`localhost`/`127.0.0.1`/`::1`) is a
 * FALSE green — `isLocalHost` runs the binary directly, no ssh — so this test
 * refuses those and demands an alias that routes to a real sshd:
 *
 *   KOLU_E2E_SSH_HOST   an ssh host/alias (NOT loopback) reaching a real sshd whose
 *                       user's Nix store this test can `nix copy` into.
 *   KOLU_E2E_PADI_DRV   the padi `.drv` to provision (e.g. `nix-instantiate .#padi`).
 *
 * Run on a `pu` box (or any host with a self-alias to its own sshd), never in the
 * from-source unit lane. Its transcript is W3.1's recorded pu-box evidence.
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { type PadiDaemonClient, scopePadiSurface } from "@kolu/padi/dial";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
} from "@kolu/padi/surface";
import { getHostSession, isLocalHost } from "@kolu/surface-nix-host";
import { afterAll, describe, expect, it } from "vitest";

const SSH_HOST = process.env.KOLU_E2E_SSH_HOST;
const PADI_DRV = process.env.KOLU_E2E_PADI_DRV;

// Guard: a real, non-loopback ssh host + a padi drv, or the whole suite skips. A
// loopback host would silently exercise the NON-ssh direct path — refuse it loudly.
const enabled =
  SSH_HOST !== undefined &&
  SSH_HOST !== "" &&
  PADI_DRV !== undefined &&
  PADI_DRV !== "";
if (enabled && isLocalHost(SSH_HOST as string)) {
  throw new Error(
    `KOLU_E2E_SSH_HOST=${SSH_HOST} is loopback — that runs padi DIRECTLY (no ssh), a false green. Use a non-loopback alias routing to a real sshd.`,
  );
}
const describeSsh = enabled ? describe : describe.skip;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** nearest-rank percentile over sorted-ascending samples. */
function pct(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1] ?? Number.NaN;
}

describeSsh("padiSurface consumed over ssh — the W3.1 named path", () => {
  const sessions: { destroy(): void }[] = [];
  const dial = () => {
    const s = getHostSession<PadiDaemonContract>({
      host: SSH_HOST as string,
      binary: "padi",
      extraArgs: ["--stdio"],
      resolveDrvPath: async () => PADI_DRV as string,
      onLog: (line) => console.log(`[host] ${line}`),
    });
    sessions.push(s);
    return s;
  };

  afterAll(() => {
    for (const s of sessions.splice(0)) s.destroy();
  });

  it("provisions padi over ssh, handshakes the control core, and round-trips a terminal", async () => {
    const session = dial();
    // pin() runs resolveDrvPath → provisionAgent (nix copy --derivation + realise)
    // → ssh <host> padi --stdio → stdioLink. The remote padi (and its kaval) is
    // durable behind the front.
    const combined = (await session.pin()) as PadiDaemonClient;
    session.markConnected();

    const hello = await combined.surface.control.core.hello();
    console.log(
      `[ssh] hello: padiSurface=${hello.surfaceVersion} controlCore=${hello.controlCoreVersion} stateRoot=${hello.stateRoot}`,
    );
    expect(
      isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION),
    ).toBe(true);

    const padi = scopePadiSurface(combined);
    const { id } = await padi.surface.lifecycle.create({
      cwd: process.env.HOME,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // terminalAttach's first frame is the snapshot, relayed straight over ssh.
    const attach = (await padi.surface.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    const first = await attach.next();
    expect(typeof first.value).toBe("string");

    await padi.surface.lifecycle.sendInput({ id, data: "echo SSHMARK\r" });
    let screen = "";
    for (let i = 0; i < 200 && !screen.includes("SSHMARK"); i++) {
      screen = await padi.surface.screen.state({ id });
      if (!screen.includes("SSHMARK")) await sleep(50);
    }
    expect(screen).toContain("SSHMARK");
    console.log("[ssh] terminal round-trip OK — echo landed over the ssh leg");
  }, 180_000);

  it("records typing-echo latency over the ssh leg (the W3 reference vs 4.36ms p99 local)", async () => {
    const session = dial();
    const combined = (await session.pin()) as PadiDaemonClient;
    session.markConnected();
    const padi = scopePadiSurface(combined);
    const { id } = await padi.surface.lifecycle.create({
      cwd: process.env.HOME,
    });

    // Subscribe attach; skip the snapshot (frame 1). Each keystroke: clock at
    // sendInput, stop when the echoed char first appears in a delta.
    const iter = (await padi.surface.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    await iter.next(); // snapshot

    const SAMPLES = Number(process.env.KOLU_BENCH_SAMPLES ?? 60);
    const WARMUP = 5;
    const latencies: number[] = [];
    for (let i = 0; i < SAMPLES + WARMUP; i++) {
      const ch = String.fromCharCode(97 + (i % 26)); // a..z, echoed by the shell
      const t0 = process.hrtime.bigint();
      await padi.surface.lifecycle.sendInput({ id, data: ch });
      // Read deltas until the echoed char appears.
      let seen = false;
      const deadline = Date.now() + 5000;
      while (!seen && Date.now() < deadline) {
        const n = await iter.next();
        if (typeof n.value === "string" && n.value.includes(ch)) seen = true;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= WARMUP && seen) latencies.push(ms);
      await padi.surface.lifecycle.sendInput({ id, data: "\r" }); // clear the line buffer
      await sleep(10);
    }

    latencies.sort((a, b) => a - b);
    const report = {
      samples: latencies.length,
      p50: pct(latencies, 50).toFixed(2),
      p90: pct(latencies, 90).toFixed(2),
      p99: pct(latencies, 99).toFixed(2),
    };
    console.log(
      `[ssh] typing-echo over ssh — p50=${report.p50}ms p90=${report.p90}ms p99=${report.p99}ms (n=${report.samples}) — W3 reference; local baseline p99 4.36ms (padi-latency-baseline)`,
    );
    // No gate — network-dependent by design; just prove we measured real samples.
    expect(latencies.length).toBeGreaterThan(10);
  }, 180_000);

  it("converges across a drain: a drained remote padi respawns and the leg recovers", async () => {
    const session = dial();
    let combined = (await session.pin()) as PadiDaemonClient;
    session.markConnected();
    let padi = scopePadiSurface(combined);

    const helloBefore = await combined.surface.control.core.hello();
    // Drain the remote padi over the frozen control core (persist + exit; its kaval
    // + PTYs survive). The front's relay ends → the HostSession reconnects and
    // frontDaemonOverStdio respawns/re-adopts padi.
    await combined.surface.control.core.drain().catch(() => {
      // The link tears down mid-response — expected.
    });

    // Re-dial a FRESH spawn (a new getHostSession session — the pooled one saw its
    // link die). Poll until the control core answers again and a terminal works.
    let recovered = false;
    const deadline = Date.now() + 60_000;
    while (!recovered && Date.now() < deadline) {
      try {
        const s2 = dial();
        combined = (await s2.pin()) as PadiDaemonClient;
        s2.markConnected();
        const helloAfter = await combined.surface.control.core.hello();
        console.log(
          `[ssh] post-drain hello: startedAt before=${helloBefore.startedAt} after=${helloAfter.startedAt} (a fresh boot ⇒ respawn; same ⇒ re-adopt)`,
        );
        padi = scopePadiSurface(combined);
        const { id } = await padi.surface.lifecycle.create({
          cwd: process.env.HOME,
        });
        await padi.surface.lifecycle.sendInput({
          id,
          data: "echo RECOVERED\r",
        });
        let screen = "";
        for (let i = 0; i < 100 && !screen.includes("RECOVERED"); i++) {
          screen = await padi.surface.screen.state({ id });
          if (!screen.includes("RECOVERED")) await sleep(50);
        }
        recovered = screen.includes("RECOVERED");
      } catch {
        await sleep(1000);
      }
    }
    expect(recovered).toBe(true);
    console.log("[ssh] convergence OK — the leg recovered after a drain");
  }, 180_000);
});
