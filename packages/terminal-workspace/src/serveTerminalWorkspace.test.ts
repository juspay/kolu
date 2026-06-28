/**
 * `serveTerminalWorkspace` — pins that the ONE factory assembles the full
 * `terminalWorkspaceSurface` server deps (the `version` cell + the fs/git
 * procedures + watcher streams), so neither home (kolu-server, `pulam`)
 * hand-assembles a second copy of the skeleton. The two volatile backings —
 * `awareness` and `activity` — are injected through verbatim.
 */

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import type { TerminalEndpointFs, TerminalEndpointGit } from "./endpoint.ts";
import {
  type AwarenessCollectionDeps,
  quietActivity,
  serveTerminalWorkspace,
} from "./serveTerminalWorkspace.ts";

// fs/git are wired into procedures/streams but never INVOKED at assembly time,
// so bare stubs suffice for the structural assertions below.
const stubEndpoint = {
  fs: {} as TerminalEndpointFs,
  git: {} as TerminalEndpointGit,
};
const stubLog = { error: () => {} } as unknown as Logger;
const stubAwareness: AwarenessCollectionDeps = {
  readAll: () => new Map(),
  upsert: () => {},
  remove: () => {},
};

describe("serveTerminalWorkspace — the ONE workspace-surface assembler", () => {
  it("assembles the full deps: version cell + fs/git procedures + watcher streams, with the backings injected verbatim", () => {
    const deps = serveTerminalWorkspace({
      awareness: stubAwareness,
      activity: quietActivity,
      endpoint: stubEndpoint,
      log: stubLog,
    });

    // The SKELETON the factory owns — the part that used to be hand-copied in
    // BOTH homes, now in exactly one place:
    expect(deps.cells?.version?.store).toBeDefined(); // version handshake cell
    expect(deps.streams?.subscribeRepoChange).toBeDefined(); // fs/git watchers
    expect(deps.streams?.subscribeFileChange).toBeDefined();
    expect(deps.procedures?.fs).toBeDefined();
    expect(deps.procedures?.git).toBeDefined();
    // `channel` is the one dep each home supplies itself — the factory omits it.
    expect("channel" in deps).toBe(false);

    // The VOLATILE backings are injected through verbatim (identity):
    expect(deps.collections?.awareness).toBe(stubAwareness);
    expect(deps.streams?.activity).toBe(quietActivity);
  });
});
