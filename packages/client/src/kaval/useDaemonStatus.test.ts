/**
 * Multi-host daemon-status projections (P3) — pure logic, hermetic.
 *
 * The module-level singleton subscription + the reattach `createRoot` effect
 * are mocked at the seam (`../wire`, `../persistedPref`, `./reattachAnnounce`)
 * so importing the module doesn't reach a live socket. We assert the two things
 * a render bug would hinge on: every `ClientDaemonState` has a presentation row
 * (a missing one crashes the chip), and `clientDaemonState` projects a remote
 * host's wire state onto the friendlier P3 labels while leaving local untouched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const statuses = vi.hoisted(() => new Map<string, { state: string }>());

vi.mock("../wire", () => ({
  app: {
    collections: {
      daemonStatus: {
        use: () => ({
          keys: () => [...statuses.keys()],
          byKey: (h: string) =>
            statuses.has(h)
              ? Object.assign(() => statuses.get(h), { pending: () => false })
              : undefined,
        }),
      },
    },
  },
}));
vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock("../persistedPref", () => ({
  persistedPref: () => [() => 0, vi.fn()],
}));
vi.mock("./reattachAnnounce", () => ({ announceReattach: vi.fn() }));

import {
  activeHostIds,
  type ClientDaemonState,
  clientDaemonState,
  DAEMON_STATE_PRESENTATION,
} from "./useDaemonStatus";

afterEach(() => statuses.clear());

describe("DAEMON_STATE_PRESENTATION", () => {
  it("has a row for every ClientDaemonState (incl. the P3 projections)", () => {
    const required: ClientDaemonState[] = [
      "connecting",
      "connected",
      "restarting",
      "degraded",
      "dead",
      "provisioning",
      "unreachable",
    ];
    for (const state of required) {
      expect(DAEMON_STATE_PRESENTATION[state]).toBeTruthy();
    }
  });

  it("marks the down states (dead/degraded/unreachable) and not the up ones", () => {
    expect(DAEMON_STATE_PRESENTATION.unreachable.down).toBe(true);
    expect(DAEMON_STATE_PRESENTATION.dead.down).toBe(true);
    expect(DAEMON_STATE_PRESENTATION.provisioning.down).toBe(false);
    expect(DAEMON_STATE_PRESENTATION.connected.down).toBe(false);
  });
});

describe("clientDaemonState — remote projection", () => {
  it("passes the local host's wire state through unchanged", () => {
    statuses.set("local", { state: "connecting" });
    expect(clientDaemonState("local")).toBe("connecting");
    statuses.set("local", { state: "degraded" });
    expect(clientDaemonState("local")).toBe("degraded");
  });

  it("projects a remote host's dialing states onto 'provisioning'", () => {
    statuses.set("prod", { state: "connecting" });
    expect(clientDaemonState("prod")).toBe("provisioning");
    statuses.set("prod", { state: "restarting" });
    expect(clientDaemonState("prod")).toBe("provisioning");
  });

  it("projects a remote host's down states onto 'unreachable'", () => {
    statuses.set("prod", { state: "degraded" });
    expect(clientDaemonState("prod")).toBe("unreachable");
    statuses.set("prod", { state: "dead" });
    expect(clientDaemonState("prod")).toBe("unreachable");
  });

  it("leaves a connected remote as 'connected' (green)", () => {
    statuses.set("prod", { state: "connected" });
    expect(clientDaemonState("prod")).toBe("connected");
  });

  it("is undefined before a host's first status yield", () => {
    expect(clientDaemonState("ghost")).toBeUndefined();
  });
});

describe("activeHostIds", () => {
  it("reports every host the server is publishing a status for", () => {
    statuses.set("local", { state: "connected" });
    statuses.set("prod", { state: "connected" });
    expect(activeHostIds().sort()).toEqual(["local", "prod"]);
  });
});
