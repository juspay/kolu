import type { DownSessionState } from "@kolu/surface-remote";
import { describe, expect, it } from "vitest";
import { padiFailureOf } from "./padiSession.ts";

const failed = (error: string): DownSessionState => ({
  phase: "failed",
  error,
  cause: "remote",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
});

const disconnected = (
  error: string,
  cause: "network" | "remote" = "network",
): DownSessionState => ({
  phase: "disconnected",
  error,
  cause,
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
});

const LOCAL = false;
const REMOTE = true;

describe("padiFailureOf — detail + transport state → published PadiEntryFailure", () => {
  it("pairs a finer arm-local detail with the transport reason", () => {
    expect(
      padiFailureOf(
        REMOTE,
        { cause: "unconverged" },
        failed("drain never took"),
      ),
    ).toEqual({ cause: "unconverged", reason: "drain never took" });
  });

  it("carries the typed skew pair through the contract-skew arm", () => {
    expect(
      padiFailureOf(
        REMOTE,
        { cause: "contract-skew-refused", running: "9.0", expected: "9.1" },
        disconnected("binder older than running padi", "remote"),
      ),
    ).toEqual({
      cause: "contract-skew-refused",
      running: "9.0",
      expected: "9.1",
      reason: "binder older than running padi",
    });
  });

  it("keeps a transient disconnected with no detail WARMING (single-meaning null)", () => {
    expect(padiFailureOf(LOCAL, null, disconnected("link blip"))).toBeNull();
    expect(padiFailureOf(REMOTE, null, disconnected("link blip"))).toBeNull();
  });

  it("classifies a LOCAL (non-provisioning) terminal give-up with no detail as local-start-failed", () => {
    expect(
      padiFailureOf(
        LOCAL,
        null,
        failed("gave up after 8 consecutive failures"),
      ),
    ).toEqual({
      cause: "local-start-failed",
      reason: "gave up after 8 consecutive failures",
    });
  });

  it("classifies a REMOTE (provisioning) terminal give-up with no detail by its transport cause", () => {
    expect(
      padiFailureOf(REMOTE, null, failed("ssh gave up after 5 dials")),
    ).toEqual({
      cause: "host-setup-failed",
      reason: "ssh gave up after 5 dials",
    });
    expect(
      padiFailureOf(REMOTE, null, {
        ...failed("'nix build' no output for 960000ms — giving up"),
        cause: "network",
      }),
    ).toEqual({
      cause: "connect-stalled",
      reason: "'nix build' no output for 960000ms — giving up",
    });
  });
});
