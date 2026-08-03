/**
 * `kolu-rpc`'s two silent seams: the argv parse and the tag lookup.
 *
 * Everything else in `wireCall.ts` is the wire itself, which only a running server
 * can prove — the NixOS adoption VM tests do that. What CANNOT be proven up there
 * cheaply is a harness bug that reads as a product failure: a payload the parse
 * dropped, or a tag that no longer exists. Both are pinned here, where a rename in
 * the contract fails a unit lane in seconds instead of a 40-minute VM lane.
 */

import { describe, expect, it } from "vitest";
import { servedGroup } from "./surface.ts";
import { parseArgs, rpcFor, wireGroup, wsUrlFor } from "./wireCall.ts";

const BASE = "http://127.0.0.1:7681";

describe("parseArgs", () => {
  it("takes url + tag with no payload (a void root procedure)", () => {
    const args = parseArgs([BASE, "daemon/restart"]);
    expect(args).toEqual({
      baseUrl: BASE,
      tag: "daemon/restart",
      payload: undefined,
      timeoutMs: 30_000,
    });
  });

  it("parses the payload as JSON, on the ENCODED side", () => {
    const args = parseArgs([
      BASE,
      "surface/padi/lifecycle/create",
      '{"mapKey":"local","input":{}}',
    ]);
    expect(args.payload).toEqual({ mapKey: "local", input: {} });
  });

  // The form `adopt.nix` / `padi-upgrade.nix` use: the helper bakes `--timeout-ms`
  // in, then the site appends its jq-built body. If the flag ate the trailing word,
  // sendInput would silently go out with NO payload.
  it("reads a payload that follows the flag as the third positional", () => {
    const args = parseArgs([
      BASE,
      "surface/padi/lifecycle/sendInput",
      "--timeout-ms",
      "90000",
      '{"mapKey":"local","input":{"id":"t1","data":"echo hi\\r"}}',
    ]);
    expect(args.timeoutMs).toBe(90_000);
    expect(args.payload).toEqual({
      mapKey: "local",
      input: { id: "t1", data: "echo hi\r" },
    });
  });

  it("rejects a missing tag, a non-number timeout, a fourth positional, and non-JSON", () => {
    expect(() => parseArgs([BASE])).toThrow(/usage:/);
    expect(() =>
      parseArgs([BASE, "daemon/restart", "--timeout-ms", "nope"]),
    ).toThrow(/positive number/);
    expect(() => parseArgs([BASE, "a/b", "{}", "extra"])).toThrow(/too many/);
    expect(() => parseArgs([BASE, "a/b", "{not json}"])).toThrow(/not JSON/);
  });
});

describe("wsUrlFor", () => {
  it("derives the /rpc/ws path the browser dials, per scheme", () => {
    expect(wsUrlFor(BASE)).toBe("ws://127.0.0.1:7681/rpc/ws");
    expect(wsUrlFor("https://kolu.example:443/")).toBe(
      "wss://kolu.example/rpc/ws",
    );
  });
});

describe("the caller's group", () => {
  // `wireGroup` is ASSEMBLED from the three sources `surface.ts` merges, not imported
  // from it (importing `surface.ts` builds the Conf store, which a one-shot caller must
  // not do). That means it can silently fall BEHIND: a fourth source merged into
  // `servedGroup` would leave `kolu-rpc` answering "no member is served at tag" for a
  // tag the server does serve. A test may import `surface.ts` (the unit lane points
  // KOLU_STATE_DIR at a temp dir), so the equality is pinned here instead.
  it("spells exactly the tag set kolu-server serves", () => {
    expect([...wireGroup.requests.keys()].sort()).toEqual(
      [...servedGroup.requests.keys()].sort(),
    );
  });
});

describe("rpcFor", () => {
  // Every tag `nix/home/example/adoption/*.nix` spells. A contract rename that
  // orphaned one of these would otherwise surface as a VM-lane poll timeout.
  it.each([
    "daemon/restart",
    "surface/padi/lifecycle/create",
    "surface/padi/lifecycle/sendInput",
    "surface/padi/lifecycle/recycleKaval",
    "surface/padi/session/restore",
  ])("resolves %s", (tag) => {
    expect(rpcFor(tag)._tag).toBe(tag);
  });

  it("names the tag and lists what IS served when the tag is unknown", () => {
    expect(() => rpcFor("surface/padi/lifecycle/nope")).toThrow(
      /no member is served at tag "surface\/padi\/lifecycle\/nope"/,
    );
  });
});
