/**
 * `createPulam` — pins that the ONE assembly returns the full served-surface
 * deps with a LIVE activity source over its own tracker (not the quiet stub), and
 * keeps the awareness write target injected verbatim. The per-terminal sensor
 * behaviour (driven by a real kaval) is covered end-to-end by the pulam daemon's
 * integration test; this is the fast, kaval-free assembly assertion — the
 * `createPulam` twin of `serveTerminalWorkspace.test.ts`.
 */

import type { PtyHostClient } from "kaval";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createPulam } from "./createPulam.ts";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";
import {
  type AwarenessCollectionDeps,
  quietActivity,
} from "./serveTerminalWorkspace.ts";

// `start` is never called here, so kaval is never touched — a bare stub suffices.
const stubKaval = {} as unknown as PtyHostClient;
const stubEndpoint = {} as TerminalWorkspaceEndpoint;
const stubLog = pino({ level: "silent" });
const stubAwareness: AwarenessCollectionDeps = {
  readAll: () => new Map(),
  upsert: () => {},
  remove: () => {},
};

describe("createPulam — the ONE pulam-library assembly", () => {
  it("returns the full served-surface deps with the injected backing + a deferred start", () => {
    const pulam = createPulam({
      kaval: stubKaval,
      awareness: stubAwareness,
      endpoint: stubEndpoint,
      log: stubLog,
    });

    // It assembles through the shared `serveTerminalWorkspace` factory — the full
    // skeleton, no second hand-rolled copy:
    expect(pulam.served.cells?.version?.store).toBeDefined();
    expect(pulam.served.streams?.subscribeRepoChange).toBeDefined();
    expect(pulam.served.streams?.subscribeFileChange).toBeDefined();
    expect(pulam.served.procedures?.fs).toBeDefined();
    expect(pulam.served.procedures?.git).toBeDefined();
    expect("channel" in pulam.served).toBe(false);

    // The awareness write target is injected through verbatim (identity):
    expect(pulam.served.collections?.awareness).toBe(stubAwareness);

    // …and the activity source is createPulam's OWN live source over its tracker,
    // NOT the quiet stub a tap-less home (kolu today) injects.
    expect(pulam.served.streams?.activity).toBeDefined();
    expect(pulam.served.streams?.activity).not.toBe(quietActivity);

    // The sensor lifecycle is deferred to `start` (the home implements the surface
    // first, then hands back the broadcasting collection handle).
    expect(typeof pulam.start).toBe("function");
  });

  it("gives each instance its own activity source (no shared per-instance state)", () => {
    const make = () =>
      createPulam({
        kaval: stubKaval,
        awareness: stubAwareness,
        endpoint: stubEndpoint,
        log: stubLog,
      });
    expect(make().served.streams?.activity).not.toBe(
      make().served.streams?.activity,
    );
  });
});
