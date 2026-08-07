/**
 * The web shell's host-daemon-inventory READ — the combine step over injected seams.
 * No filesystem, no socket: it drives `enumerateDaemonInventoryOnce` and asserts the
 * reshaped `daemonInventory` value (binding · boundPadi) it RETURNS (the reactor poll
 * cell publishes it — SR8.a; the loop that used to publish is gone).
 *
 * The bound host's daemons are NOT the shell's concern anymore — padi serves them on
 * `padiSurface.hostInventory` (tested in @kolu/padi's `hostInventory.test.ts`). Here the
 * shell reads the LOCAL-machine scan (only under a remote binding) + the binding host
 * + the bound padi's honest identity/convergence.
 *
 * The non-overlap / coalesce / force-resample behavior the retired
 * `startDaemonInventorySampler` loop used to spell is now the reactor poll source's,
 * pinned in `@kolu/surface`'s `reactor.test.ts` ("non-overlap guard COALESCES a tick
 * during an in-flight read into ONE trailing read"); the onState force-resample cadence
 * rides the same reactor's graduated `everyMsOr` fuse (SR8.c), pinned there too.
 */

import type { KavalProbe, PadiDaemon } from "@kolu/padi/assembly";
import type { KavalDaemon } from "kaval";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { enumerateDaemonInventoryOnce } from "./daemonInventory.ts";

const KAVAL = "/run/user/1000/kaval-abc123/pty-host.sock";
const PADI = "/run/user/1000/padi-abc123/padi.sock";

const kaval = (over: Partial<KavalDaemon> = {}): KavalDaemon => ({
  socket: KAVAL,
  label: "kolu @ /home/u/.local/state/padi",
  kind: "stateRoot",
  gatePid: 4242,
  ...over,
});

const padi = (over: Partial<PadiDaemon> = {}): PadiDaemon => ({
  socket: PADI,
  stateRoot: "/home/u/.local/state/padi",
  gatePid: 111,
  ...over,
});

const probe = (over: Partial<KavalProbe> = {}): KavalProbe => ({
  terminalCount: 3,
  buildCommit: "abc1234",
  contractVersion: "5.0",
  ...over,
});

type Deps = Parameters<typeof enumerateDaemonInventoryOnce>[0];

/** Run the read. `enumerateDaemonInventoryOnce` is an Effect now; a test IS a process
 *  edge, so it runs it here rather than restructuring every assertion. */
const run = (d: Deps) => Effect.runPromise(enumerateDaemonInventoryOnce(d));

const deps = (over: Partial<Deps> = {}): Deps => ({
  discoverKavals: () => [kaval()],
  discoverPadis: () => [padi()],
  probe: () => Effect.succeed(probe()),
  activePadiSurfaceVersion: () => "1.2",
  activePadiBuildCommit: () => "localcommit",
  activePadiConvergence: () => null,
  boundHost: null,
  ...over,
});

describe("enumerateDaemonInventoryOnce — local binding", () => {
  it("does NOT scan the local machine (the bound padi's member already covers it): localScan is null", async () => {
    // A discovery that would THROW if called — proving the local scan is skipped entirely
    // under a local binding, not merely emptied.
    const inv = await run(
      deps({
        discoverKavals: () => {
          throw new Error("local scan must not run under a local binding");
        },
        discoverPadis: () => {
          throw new Error("local scan must not run under a local binding");
        },
      }),
    );
    // The union makes a local binding carry NO scan by construction — not merely a null
    // one — so `{ kind: "local" }` is the whole binding.
    expect(inv.binding).toEqual({ kind: "local" });
  });

  it("returns the bound padi's honest identity on boundPadi (works over ssh; no local active row needed)", async () => {
    const inv = await run(deps());
    expect(inv.boundPadi).toEqual({
      surfaceVersion: "1.2",
      buildCommit: "localcommit",
      convergence: null,
    });
  });

  it("boundPadi is null only when there is NOTHING to say (no identity AND no convergence)", async () => {
    const inv = await run(
      deps({
        activePadiSurfaceVersion: () => null,
        activePadiBuildCommit: () => null,
        activePadiConvergence: () => null,
      }),
    );
    expect(inv.boundPadi).toBeNull();
  });
});

describe("enumerateDaemonInventoryOnce — remote binding", () => {
  it("scans the LOCAL machine into localScan, marking NONE active — a leak stays visible, never 'in use by kolu'", async () => {
    const inv = await run(
      deps({
        boundHost: "nix@remote.example",
        // The bound padi is REMOTE — its honest identity rides boundPadi, and must NOT land
        // on any local row.
        activePadiSurfaceVersion: () => "9.9",
        activePadiBuildCommit: () => "remotecommit",
      }),
    );
    const binding = inv.binding;
    if (binding?.kind !== "remote")
      throw new Error("expected a remote binding");
    // The local machine's daemons ARE listed (a leak on the machine you're using stays
    // visible) …
    expect(binding.localScan.kavals).toHaveLength(1);
    expect(binding.localScan.padis).toHaveLength(1);
    // … but NONE is kolu's active one (no "in use by kolu" lie on a local socket). The
    // remote padi's version/commit ride boundPadi, never a local row.
    expect(binding.localScan.kavals[0]?.held.active).toBe(false);
    expect(binding.localScan.padis[0]?.active).toBe(false);
  });

  it("returns boundHost = the remote host so the dialog labels the local scan 'not the bound host'", async () => {
    const inv = await run(deps({ boundHost: "nix@prod.example" }));
    expect(inv.binding).toMatchObject({
      kind: "remote",
      host: "nix@prod.example",
    });
    // The BOUND padi's identity rides boundPadi (off the session readouts), so the Padi
    // dialog's version + build-commit work over ssh even though NO local padi is active.
    expect(inv.boundPadi).toEqual({
      surfaceVersion: "1.2",
      buildCommit: "localcommit",
      convergence: null,
    });
  });

  it("a degraded bind with NO adopted identity (skew/link-failed) still returns boundPadi carrying the convergence reason", async () => {
    const inv = await run(
      deps({
        boundHost: "nix@prod.example",
        // A REFUSED / FAILED bind: no adopted identity, but a standing convergence reason.
        activePadiSurfaceVersion: () => null,
        activePadiBuildCommit: () => null,
        activePadiConvergence: () => ({
          kind: "skew-refused",
          running: {
            contractVersion: "99.0",
            build: { kind: "known", id: "x" },
          },
          expected: {
            contractVersion: "5.0",
            build: { kind: "known", id: "y" },
          },
          detail:
            "padi contract skew: remote serves 99.0, kolu-server needs 5.0 — refusing",
        }),
      }),
    );
    // boundPadi must be NON-null even with null identity — else the Padi dialog's degraded
    // banner would vanish for a refused/failed bind (the exact null-vs-nonnull case).
    expect(inv.boundPadi).toEqual({
      surfaceVersion: null,
      buildCommit: null,
      convergence: {
        kind: "skew-refused",
        running: {
          contractVersion: "99.0",
          build: { kind: "known", id: "x" },
        },
        expected: {
          contractVersion: "5.0",
          build: { kind: "known", id: "y" },
        },
        detail:
          "padi contract skew: remote serves 99.0, kolu-server needs 5.0 — refusing",
      },
    });
  });
});
