import type { Endpoint } from "@kolu/surface-daemon-supervisor";
import type { PtyHostClient, PtyHostIdentity } from "kaval";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KavalConnectionMetadata } from "./connect.ts";
import { __setEndpointForTest, currentKavalProcessTarget } from "./index.ts";

type KavalEndpoint = Endpoint<
  PtyHostClient,
  PtyHostIdentity,
  KavalConnectionMetadata
>;
type KavalConnection = NonNullable<ReturnType<KavalEndpoint["current"]>>;

let restoreEndpoint = (): void => {};

afterEach(() => {
  restoreEndpoint();
  restoreEndpoint = (): void => {};
});

describe("currentKavalProcessTarget", () => {
  it("takes both identity fields from one held endpoint connection", () => {
    const heldConnection = {
      metadata: { contractVersion: "6.0", pid: 4_242 },
      startedAt: 1_000,
    } as KavalConnection;
    const replacementConnection = {
      metadata: { contractVersion: "6.0", pid: 9_999 },
      startedAt: 2_000,
    } as KavalConnection;
    const current = vi
      .fn<KavalEndpoint["current"]>()
      .mockReturnValueOnce(heldConnection)
      .mockReturnValue(replacementConnection);
    // The production read uses only `current`; restart behavior is outside this
    // test, so the remaining Endpoint members are deliberately absent.
    const endpoint = { current } as unknown as KavalEndpoint;
    restoreEndpoint = __setEndpointForTest(endpoint);

    const target = currentKavalProcessTarget();

    expect(target).toEqual({ pid: 4_242, startedAt: 1_000 });
    expect(Object.isFrozen(target)).toBe(true);
    expect(current).toHaveBeenCalledTimes(1);
  });
});
