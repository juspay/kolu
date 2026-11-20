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

const run = (d: Deps) => Effect.runPromise(enumerateDaemonInventoryOnce(d));

const deps = (over: Partial<Deps> = {}): Deps => ({
  discoverKavals: () => [kaval()],
  discoverPadis: () => [padi()],
  probe: () => Effect.succeed(probe()),
  activePadiSurfaceVersion: () => "1.2",
  activePadiBuildCommit: () => "localcommit",
  activePadiConvergence: () => null,
  binding: { kind: "local" },
  ...over,
});

describe("enumerateDaemonInventoryOnce — local binding", () => {
  it("does NOT scan the local machine (the bound padi's member already covers it): localScan is null", async () => {
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
        binding: { kind: "remote", host: "nix@remote.example" },
        activePadiSurfaceVersion: () => "9.9",
        activePadiBuildCommit: () => "remotecommit",
      }),
    );
    const binding = inv.binding;
    if (binding?.kind !== "remote")
      throw new Error("expected a remote binding");
    expect(binding.localScan.kavals).toHaveLength(1);
    expect(binding.localScan.padis).toHaveLength(1);
    expect(binding.localScan.kavals[0]?.held.active).toBe(false);
    expect(binding.localScan.padis[0]?.active).toBe(false);
  });

  it("names the bound host so the dialog labels the local scan 'not the bound host'", async () => {
    const inv = await run(
      deps({ binding: { kind: "remote", host: "nix@prod.example" } }),
    );
    expect(inv.binding).toMatchObject({
      kind: "remote",
      host: "nix@prod.example",
    });
    expect(inv.boundPadi).toEqual({
      surfaceVersion: "1.2",
      buildCommit: "localcommit",
      convergence: null,
    });
  });

  it("a degraded bind with NO adopted identity (skew/link-failed) still returns boundPadi carrying the convergence reason", async () => {
    const inv = await run(
      deps({
        binding: { kind: "remote", host: "nix@prod.example" },
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
