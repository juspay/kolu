import type { PortInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  FORWARD_REASON,
  NO_MECHANISM_REASON,
  portAction,
  reachReason,
  rowAction,
} from "./portAction";
import type { PortRow } from "./portRows";
describe("FORWARD_REASON", () => {
  it("has words for every forward mechanism, and says which is which", () => {
    expect(FORWARD_REASON["remote-host"]).toMatch(/remote host/);
    expect(FORWARD_REASON.loopback).toMatch(/loopback/);
  });

  it("promises a forward rather than a future release", () => {
    for (const reason of Object.values(FORWARD_REASON)) {
      expect(reason).not.toMatch(/coming/);
      expect(reason).toMatch(/forward/);
    }
  });
});

describe("NO_MECHANISM_REASON", () => {
  it("offers nothing, because there is nothing to offer", () => {
    expect(NO_MECHANISM_REASON["interface-bind"]).toMatch(/no forward/);
  });
});

describe("portAction", () => {
  it("opens on the PAGE's host when the port already answers there", () => {
    expect(
      portAction({ reach: { kind: "direct" }, viewerOnHost: false }),
    ).toEqual({ kind: "here" });
  });

  it("opens on the VIEWER's own loopback when the viewer is on that host", () => {
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "remote-host" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "viewer" });
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "loopback" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "viewer" });
  });

  it("does NOT rescue the arm no forward can serve, even for a viewer on that host", () => {
    expect(
      portAction({
        reach: { kind: "no-mechanism", via: "interface-bind" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does NOT rewrite a directly-answering port to localhost", () => {
    expect(
      portAction({ reach: { kind: "direct" }, viewerOnHost: true }),
    ).toEqual({ kind: "here" });
  });

  it("keeps the forward when kolu cannot tell where the viewer is", () => {
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "remote-host" },
        viewerOnHost: false,
      }),
    ).toEqual({ kind: "forward" });
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "loopback" },
        viewerOnHost: false,
      }),
    ).toEqual({ kind: "forward" });
  });

  it("says nothing is reachable when nothing is", () => {
    expect(
      portAction({
        reach: { kind: "no-mechanism", via: "interface-bind" },
        viewerOnHost: false,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("rowAction — the row KIND decides before any reach is judged", () => {
  const info = (scope: PortInfo["scope"]): PortInfo => ({
    port: 5173,
    name: "node",
    command: "node vite",
    scope,
    family: "v4",
  });
  const orphan: PortRow = {
    kind: "orphan",
    port: 5173,
    forward: {
      key: "remote:pu-dev:5173",
      host: { kind: "remote", target: "pu-dev" },
      remotePort: 5173,
      localPort: 61003,
      origin: "auto",
      createdAt: 0,
    },
  };

  it("points an orphan at its own DOOR, even for a viewer on that host", () => {
    expect(
      rowAction({ row: orphan, onKoluHost: false, viewerOnHost: true }),
    ).toEqual({ action: { kind: "forward" }, reason: undefined });
    expect(
      rowAction({ row: orphan, onKoluHost: true, viewerOnHost: false }),
    ).toEqual({ action: { kind: "forward" }, reason: undefined });
  });

  it("gives a scanned row the judge's answer and the judge's sentence", () => {
    const row: PortRow = {
      kind: "port",
      port: 5173,
      info: info("loopback"),
      origin: "subtree",
      forward: undefined,
    };
    expect(rowAction({ row, onKoluHost: true, viewerOnHost: false })).toEqual({
      action: { kind: "forward" },
      reason: FORWARD_REASON.loopback,
    });
  });

  it("says the same about an interface bind on either host", () => {
    const row: PortRow = {
      kind: "port",
      port: 5173,
      info: info("interface"),
      origin: "subtree",
      forward: undefined,
    };
    for (const onKoluHost of [true, false]) {
      expect(rowAction({ row, onKoluHost, viewerOnHost: false })).toEqual({
        action: { kind: "none" },
        reason: NO_MECHANISM_REASON["interface-bind"],
      });
    }
  });
});

describe("rowAction — an unclaimed bind", () => {
  it("is judged by its bind exactly like a claimed port", () => {
    const row: PortRow = {
      kind: "unclaimed",
      port: 8443,
      bind: { port: 8443, scope: "loopback", family: "v4" },
      origin: "printed",
      forward: undefined,
    };
    expect(rowAction({ row, onKoluHost: true, viewerOnHost: false })).toEqual({
      action: { kind: "forward" },
      reason: FORWARD_REASON.loopback,
    });
  });
});

describe("reachReason", () => {
  it("is total over PortReach, and silent for the arm that needs no sentence", () => {
    expect(reachReason({ kind: "direct" })).toBeUndefined();
    expect(reachReason({ kind: "needs-forward", via: "loopback" })).toBe(
      FORWARD_REASON.loopback,
    );
    expect(reachReason({ kind: "no-mechanism", via: "interface-bind" })).toBe(
      NO_MECHANISM_REASON["interface-bind"],
    );
  });
});
