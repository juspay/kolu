import type { SessionState, SshProv } from "@kolu/surface-remote";
import { match } from "ts-pattern";
import { describe, expect, it } from "vitest";
import { padiMemoryReadable } from "./padiMemoryGate.ts";

const at = (phase: SessionState<SshProv>["phase"]): SessionState<SshProv> =>
  match<typeof phase, SessionState<SshProv>>(phase)
    .with("connected", (p) => ({
      phase: p,
      clockOffset: null,
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    }))
    .with("absent", (p) => ({
      phase: p,
      error: "nothing is serving there",
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    }))
    .with("disconnected", (p) => ({
      phase: p,
      error: "link down",
      cause: "network",
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    }))
    .with("failed", (p) => ({
      phase: p,
      error: "gave up",
      cause: "remote",
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    }))
    .with("connecting", "probing", "provisioning", (p) => ({
      phase: p,
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    }))
    .exhaustive();

const session = (opts: {
  destroyed: boolean;
  phase: SessionState<SshProv>["phase"];
}) => ({
  isDestroyed: () => opts.destroyed,
  currentState: () => at(opts.phase),
});

describe("padiMemoryReadable — the memory-rail liveness policy (LIVE-FIX)", () => {
  it("is true ONLY when a live (not-destroyed) session is connected", () => {
    expect(
      padiMemoryReadable(session({ destroyed: false, phase: "connected" })),
    ).toBe(true);
  });

  it("is false for every up-but-not-connected and down phase, local AND remote (the honest absent)", () => {
    for (const phase of [
      "connecting",
      "probing",
      "provisioning",
      "disconnected",
      "failed",
    ] as const) {
      expect(padiMemoryReadable(session({ destroyed: false, phase }))).toBe(
        false,
      );
    }
  });

  it("is false for a DESTROYED session even with a stale `connected` frame", () => {
    expect(
      padiMemoryReadable(session({ destroyed: true, phase: "connected" })),
    ).toBe(false);
  });
});
