/**
 * The Before-hook retry/permanent split, pinned on the wire's own vocabulary.
 *
 * `waitForPadiLive` polls `surface/padi/lifecycle/killAll` until the async-warming
 * padi binding answers, and {@link isPadiWarmingUp} is the ONLY thing standing between
 * "poll again" and a hard `padi liveness probe failed permanently`. Getting one tag on
 * the wrong side of that line kills every scenario in a worker — which is exactly what
 * `dock.feature` hit: a padi caught mid-RESTART answers with the entry link's
 * `SurfaceStdioTransportClosed`, and classifying that as permanent failed the hook
 * forever instead of waiting the ~second the respawn takes.
 *
 * Every case below branches on the DECLARED `_tag` (the classes are the ones
 * `@kolu/surface/errors` puts on the wire), never on prose — the last case pins that
 * directly.
 */

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

/** An ANSWERED call: the wire carried the server's declared failure back. */
const answered = (failure: unknown): RpcCallFailed =>
  new RpcCallFailed(KILL_ALL, failure, false);

test("a padi respawning mid-probe is WARMING UP, not permanent", () => {
  // The regression: the map forwards the entry link's death verbatim, so a call
  // issued while padi is being replaced answers with the closed stdio leg. The
  // binding re-dials, so the very next poll can succeed.
  assert.equal(
    isPadiWarmingUp(
      answered(new SurfaceStdioTransportClosed({ reason: "padi respawning" })),
    ),
    true,
  );
  // The re-serve's middle-hop drop is the same "the parent will heal it" shape.
  assert.equal(
    isPadiWarmingUp(
      answered(new SurfaceRelayTransportLost({ reason: "upstream gone" })),
    ),
    true,
  );
});

test("an unseeded host key is WARMING UP; the map's other rejections are PERMANENT", () => {
  // Not seeded yet — the host pool has no entry to route to.
  assert.equal(
    isPadiWarmingUp(answered(new MapKeyUnknown({ mapKey: "local" }))),
    true,
  );
  // A terminally-failed entry and a non-canonical key are real, answered rejections:
  // polling them just re-reads the same verdict, exactly as a non-503 HTTP status did.
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
  // Before the map declared the transport deaths on its folded error channel, this
  // string defect (the parse failure's own message) is all that reached the caller.
  // It must stay permanent: matching it would be classifying on prose, and would
  // silently re-hide the day the product's declaration regressed.
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
