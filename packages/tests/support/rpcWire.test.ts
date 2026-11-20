import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MapEntryFailed,
  MapKeyNonCanonical,
  MapKeyUnknown,
  SurfaceRelayTransportLost,
  SurfaceStdioTransportClosed,
  SurfaceTransportRetired,
} from "@kolu/surface/errors";
import { isPadiWarmingUp, RpcCallFailed } from "./rpcWire.ts";

const KILL_ALL = "surface/padi/lifecycle/killAll";

const answered = (failure: unknown): RpcCallFailed =>
  new RpcCallFailed(KILL_ALL, failure, false);

test("a padi respawning mid-probe is WARMING UP, not permanent", () => {
  assert.equal(
    isPadiWarmingUp(
      answered(new SurfaceStdioTransportClosed({ reason: "padi respawning" })),
    ),
    true,
  );
  assert.equal(
    isPadiWarmingUp(
      answered(new SurfaceRelayTransportLost({ reason: "upstream gone" })),
    ),
    true,
  );
});

test("an unseeded host key is WARMING UP; the map's other rejections are PERMANENT", () => {
  assert.equal(
    isPadiWarmingUp(answered(new MapKeyUnknown({ mapKey: "local" }))),
    true,
  );
  assert.equal(
    isPadiWarmingUp(
      answered(new MapEntryFailed({ mapKey: "local", failure: "drv-missing" })),
    ),
    false,
  );
  assert.equal(
    isPadiWarmingUp(
      answered(
        new MapKeyNonCanonical({ wireKey: "Local", canonicalKey: "local" }),
      ),
    ),
    false,
  );
});

test("a RETIRED browser socket stays permanent — re-dialling re-presents the corpse", () => {
  assert.equal(
    isPadiWarmingUp(
      answered(new SurfaceTransportRetired({ reason: "stale pid" })),
    ),
    false,
  );
});

test("the flattened prose shape is NOT retried — the declaration is what carries the fix", () => {
  assert.equal(
    isPadiWarmingUp(
      answered(
        "Expected MapKeyNonCanonical | MapKeyUnknown | MapEntryFailed, got SurfaceStdioTransportClosed",
      ),
    ),
    false,
  );
});

test("a per-call timeout is WARMING UP; a non-wire error is not classified at all", () => {
  assert.equal(isPadiWarmingUp(new RpcCallFailed(KILL_ALL, null, true)), true);
  assert.equal(isPadiWarmingUp(new Error("something else entirely")), false);
});
