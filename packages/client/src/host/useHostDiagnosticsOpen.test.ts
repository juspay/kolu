// @vitest-environment happy-dom
/**
 * Which host's details are open, and what the panel hangs off — two separate
 * facts.
 *
 * The shell keys the panel on the HOST, so re-opening the same machine from a
 * different opener (its tab mark, then its name in Settings) must only MOVE
 * the panel: a new identity would tear it down and build it again, losing its
 * subscriptions and any pending "remove host" confirmation. And the element
 * belongs to its opener: when that unmounts — an overflowed chip, Settings
 * closing, a regrouped fleet line — the panel closes rather than floating
 * against a node that is no longer on screen.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { flush } from "solid-js";
import {
  closeHostDiagnostics,
  hostDiagnosticsAnchor,
  openHostDiagnostics,
  openHostDiagnosticsKey,
  releaseHostDiagnosticsAnchor,
  toggleHostDiagnostics,
} from "./useHostDiagnosticsOpen";

const mark = document.createElement("button");
const fleetName = document.createElement("button");

beforeEach(() => {
  closeHostDiagnostics();
});

describe("the open host-details panel", () => {
  // Opening, moving and releasing are commands; each write is staged, so the
  // panel's state is read on the flush after it.
  it("keeps its host while another opener moves where it floats", () => {
    openHostDiagnostics("local", mark);
    flush();
    expect(openHostDiagnosticsKey()).toBe("local");

    openHostDiagnostics("local", fleetName);
    flush();
    expect(openHostDiagnosticsKey()).toBe("local");
    expect(hostDiagnosticsAnchor()).toBe(fleetName);
  });

  it("closes when the element it hangs off goes away", () => {
    openHostDiagnostics("local", fleetName);
    // Another opener's element leaving is not this panel's business.
    releaseHostDiagnosticsAnchor(mark);
    flush();
    expect(openHostDiagnosticsKey()).toBe("local");

    releaseHostDiagnosticsAnchor(fleetName);
    flush();
    expect(openHostDiagnosticsKey()).toBeNull();
    expect(hostDiagnosticsAnchor()).toBeUndefined();
  });

  it("closes on the pip's second click, and moves on another host's", () => {
    toggleHostDiagnostics("local", mark);
    flush();
    expect(openHostDiagnosticsKey()).toBe("local");
    toggleHostDiagnostics("local", mark);
    flush();
    expect(openHostDiagnosticsKey()).toBeNull();
    toggleHostDiagnostics("remote:zest", mark);
    flush();
    expect(openHostDiagnosticsKey()).toBe("remote:zest");
  });
});
