import { describe, expect, it } from "vitest";
import { ptyDaemonView } from "./ptyDaemonView";

describe("ptyDaemonView", () => {
  it("defaults to starting when status is undefined (no yield yet)", () => {
    expect(ptyDaemonView(undefined)).toEqual({
      tone: "starting",
      label: "Local PTY daemon: starting…",
    });
  });

  it("maps a ready, up-to-date daemon to the connected tone", () => {
    expect(ptyDaemonView({ state: "ready", outdated: false })).toEqual({
      tone: "ready",
      label: "Local PTY daemon: connected",
    });
  });

  it("maps a down daemon to the disconnected tone", () => {
    expect(ptyDaemonView({ state: "down" }).tone).toBe("down");
  });

  it("flags an outdated ready daemon and names both versions", () => {
    const view = ptyDaemonView({
      state: "ready",
      outdated: true,
      pkgVersion: "0.41.0",
      serverPkgVersion: "0.42.0",
    });
    expect(view.tone).toBe("outdated");
    expect(view.label).toBe(
      "Local PTY daemon: update pending (running 0.41.0, server 0.42.0) — restart to apply",
    );
  });

  it("does not nudge while the daemon is still starting, even if outdated is set", () => {
    // `outdated` only carries meaning once a handshake has completed
    // (state === "ready"); a starting/down daemon ignores it.
    expect(ptyDaemonView({ state: "starting", outdated: true }).tone).toBe(
      "starting",
    );
    expect(ptyDaemonView({ state: "down", outdated: true }).tone).toBe("down");
  });

  it("falls back to '?' for missing versions on an outdated daemon", () => {
    expect(ptyDaemonView({ state: "ready", outdated: true }).label).toBe(
      "Local PTY daemon: update pending (running ?, server ?) — restart to apply",
    );
  });
});
