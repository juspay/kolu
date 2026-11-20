// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
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
  it("keeps its host while another opener moves where it floats", () => {
    openHostDiagnostics("local", mark);
    expect(openHostDiagnosticsKey()).toBe("local");

    openHostDiagnostics("local", fleetName);
    expect(openHostDiagnosticsKey()).toBe("local");
    expect(hostDiagnosticsAnchor()).toBe(fleetName);
  });

  it("closes when the element it hangs off goes away", () => {
    openHostDiagnostics("local", fleetName);
    releaseHostDiagnosticsAnchor(mark);
    expect(openHostDiagnosticsKey()).toBe("local");

    releaseHostDiagnosticsAnchor(fleetName);
    expect(openHostDiagnosticsKey()).toBeNull();
    expect(hostDiagnosticsAnchor()).toBeUndefined();
  });

  it("closes on the pip's second click, and moves on another host's", () => {
    toggleHostDiagnostics("local", mark);
    expect(openHostDiagnosticsKey()).toBe("local");
    toggleHostDiagnostics("local", mark);
    expect(openHostDiagnosticsKey()).toBeNull();
    toggleHostDiagnostics("remote:zest", mark);
    expect(openHostDiagnosticsKey()).toBe("remote:zest");
  });
});
