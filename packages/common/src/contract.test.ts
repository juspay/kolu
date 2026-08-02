/**
 * The contract's WIRE TAG SET — the replacement for the deleted oRPC
 * router-path tests (PLAN D1 / review #16).
 *
 * `RpcGroup.make` / `.merge` are last-writer-wins `Map.set`s with no collision
 * detection, and a dynamically assembled group carries no type-level safety, so
 * the only honest gate on "does the contract serve what it claims" is the
 * literal key set. Spelled out here rather than derived, so a member that
 * silently disappears (a collision, a spec walk that stopped early) fails HERE
 * rather than as a 404 on the first call.
 */

import { describe, expect, it } from "vitest";
import {
  contract,
  koluRootGroup,
  koluSurfaceGroup,
  ROOT_RPC_TAGS,
  ServerInfoSchema,
} from "./contract.ts";
import { surfaces } from "./surface.ts";

const tagsOf = (group: { readonly requests: ReadonlyMap<string, unknown> }) =>
  [...group.requests.keys()].sort();

describe("the root procedures", () => {
  it("carries EXACTLY the seven declared root tags", () => {
    expect(tagsOf(koluRootGroup)).toEqual([...ROOT_RPC_TAGS].sort());
  });

  it("keeps every root tag OUT of the `surface/` namespace", () => {
    // The flat namespace is what lets a raw procedure and a surface member
    // coexist; a root tag that wandered under `surface/` could shadow one.
    for (const tag of ROOT_RPC_TAGS) {
      expect(tag.startsWith("surface/")).toBe(false);
    }
  });

  it("declares `hosts/viewer` as a ROOT procedure, not a surface member", () => {
    // The per-CALLER answer (kolu#W10): a broadcast cell cannot carry a
    // different value to each viewer, so this must stay a procedure.
    expect(koluRootGroup.requests.has("hosts/viewer")).toBe(true);
    expect(tagsOf(koluSurfaceGroup)).not.toContain("hosts/viewer");
  });
});

describe("the composed surface siblings", () => {
  it("tags every member `surface/<sibling>/<member>/<verb>`", () => {
    const siblings = new Set(Object.keys(surfaces));
    for (const tag of tagsOf(koluSurfaceGroup)) {
      const [root, sibling] = tag.split("/");
      expect(root).toBe("surface");
      expect(siblings.has(String(sibling))).toBe(true);
    }
  });

  it("gives EACH sibling its own three reserved `system/*` members", () => {
    // The reason composition re-walks per sibling instead of merging groups
    // (PLAN D1): a bare merge would leave one sibling's liveness probe
    // answering for the other's, silently.
    for (const sibling of Object.keys(surfaces)) {
      for (const verb of ["live", "identity", "clockNow"]) {
        expect(
          koluSurfaceGroup.requests.has(`surface/${sibling}/system/${verb}`),
        ).toBe(true);
      }
    }
  });

  it("serves kolu's own cells and the forwards procedures at their wire tags", () => {
    for (const tag of [
      "surface/kolu/preferences/get",
      "surface/kolu/preferences/patch",
      "surface/kolu/preferences/test__set",
      "surface/kolu/viewerMode/get",
      "surface/kolu/viewerMode/set",
      "surface/kolu/processMemory/get",
      "surface/kolu/padiLink/get",
      "surface/kolu/processStartedAt/get",
      "surface/kolu/daemonInventory/get",
      "surface/kolu/forwards/get",
      "surface/kolu/forwards/create",
      "surface/kolu/forwards/cancel",
      "surface/surfaceApp/buildInfo/get",
      "surface/surfaceApp/identity/info",
    ]) {
      expect(koluSurfaceGroup.requests.has(tag)).toBe(true);
    }
  });

  it("does NOT publish a write verb for a read-only cell", () => {
    expect(koluSurfaceGroup.requests.has("surface/kolu/forwards/set")).toBe(
      false,
    );
    expect(
      koluSurfaceGroup.requests.has("surface/surfaceApp/buildInfo/set"),
    ).toBe(false);
  });
});

describe("the assembled contract", () => {
  it("is exactly the two halves, with nothing dropped by the merge", () => {
    expect(contract.requests.size).toBe(
      koluSurfaceGroup.requests.size + koluRootGroup.requests.size,
    );
    expect(tagsOf(contract)).toEqual(
      [...tagsOf(koluSurfaceGroup), ...tagsOf(koluRootGroup)].sort(),
    );
  });

  it("carries NO `padi` sibling — kolu-server splices that locally", () => {
    // The package-boundary seal: the client consumes the padi-less contract.
    for (const tag of tagsOf(contract)) {
      expect(tag.startsWith("surface/padi/")).toBe(false);
    }
  });

  it("keeps `server/info`'s success shape at the branding it exists for", () => {
    expect(Object.keys(ServerInfoSchema.fields)).toEqual(["identity"]);
  });
});
