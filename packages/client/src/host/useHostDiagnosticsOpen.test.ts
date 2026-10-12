// @vitest-environment happy-dom
/**
 * Which host's details are open, and what the panel hangs off.
 *
 * The shell renders the panel `keyed` on this value, so VALUE IDENTITY is the
 * remount rule: re-opening the host that is already open off the same element
 * (clicking its mark, or its name in Settings, twice) must keep the very same
 * value — a fresh literal would tear the panel down and build it again, losing
 * its subscriptions and any pending "remove host" confirmation. A different
 * host, or the same host off a different element, IS a different panel.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  closeHostDiagnostics,
  openHostDiagnostics,
  openHostDiagnosticsState,
  toggleHostDiagnostics,
} from "./useHostDiagnosticsOpen";

const mark = document.createElement("button");
const fleetName = document.createElement("button");

beforeEach(() => {
  closeHostDiagnostics();
});

describe("the open host-details panel", () => {
  it("keeps the same value when the same opener opens it again", () => {
    openHostDiagnostics("local", mark);
    const first = openHostDiagnosticsState();
    openHostDiagnostics("local", mark);
    expect(openHostDiagnosticsState()).toBe(first);
  });

  it("is a new value for another host, or the same host off another element", () => {
    openHostDiagnostics("local", mark);
    const first = openHostDiagnosticsState();

    openHostDiagnostics("local", fleetName);
    expect(openHostDiagnosticsState()).not.toBe(first);
    expect(openHostDiagnosticsState()?.anchor).toBe(fleetName);

    openHostDiagnostics("remote:zest", fleetName);
    expect(openHostDiagnosticsState()?.key).toBe("remote:zest");
  });

  it("closes on the pip's second click, and moves on another host's", () => {
    toggleHostDiagnostics("local", mark);
    expect(openHostDiagnosticsState()?.key).toBe("local");
    toggleHostDiagnostics("local", mark);
    expect(openHostDiagnosticsState()).toBeNull();
    toggleHostDiagnostics("remote:zest", mark);
    expect(openHostDiagnosticsState()?.key).toBe("remote:zest");
  });
});
