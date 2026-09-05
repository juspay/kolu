/**
 * The forgery the BRAND alone does not stop — pinned, because the fix for it is
 * a single line in `keepaliveOpts` that reads like a redundant assertion and is
 * exactly the kind of line a later cleanup deletes.
 *
 * `SshKeepalive` is nominal: a private symbol means only `sshKeepalive()` can
 * MINT one, so a bare object literal is a compile error and there is one
 * construction site with one error message. What the symbol does NOT stop is
 * ordinary object spread, which COPIES it while replacing the numbers:
 *
 *     const forged: SshKeepalive = { ...sshKeepalive(10, 3), intervalS: 0 };
 *
 * That typechecks with no cast and no `any`. Rendered, it is
 * `ServerAliveInterval=0` — which does not make ssh probe faster, it turns
 * dead-peer detection OFF, restoring the eternal park on a half-open socket
 * that this option exists to bound. So the invariant is bought at the RENDER
 * choke point, and this file is what breaks if that check goes away.
 */
import { describe, expect, it } from "vitest";
import { nixSshOpts, sshCommonOpts, sshDialOpts } from "./host";
import {
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
  type SshKeepalive,
  sshKeepalive,
} from "./keepalive";

/** Spread-and-replace: the private symbol rides along, the numbers do not. No
 *  cast — if this line ever stops typechecking, the brand got stronger and this
 *  whole file can be reconsidered. */
const forge = (over: Partial<SshKeepalive>): SshKeepalive => ({
  ...sshKeepalive(10, 3),
  ...over,
});

describe("a spread-forged keepalive is rejected where it is rendered", () => {
  it("refuses intervalS=0 — the value that DISABLES ssh keepalive", () => {
    expect(() => sshCommonOpts(forge({ intervalS: 0 }))).toThrow(
      /intervalS must be a positive integer/,
    );
  });

  it("refuses countMax=0, a fraction, and a negative", () => {
    expect(() => sshCommonOpts(forge({ countMax: 0 }))).toThrow(
      /countMax must be a positive integer/,
    );
    expect(() => sshCommonOpts(forge({ intervalS: 2.5 }))).toThrow(
      /intervalS must be a positive integer/,
    );
    expect(() => sshCommonOpts(forge({ countMax: -1 }))).toThrow(
      /countMax must be a positive integer/,
    );
  });

  it("refuses a tolerance past the ceiling, with the constructor's message", () => {
    const past = forge({ intervalS: 3_600, countMax: 2 });
    expect(() => sshCommonOpts(past)).toThrow(
      new RegExp(`must be ≤ ${MAX_SSH_KEEPALIVE_TOLERANCE_S}s`),
    );
  });

  it("rejects at EVERY render shape, because they share the one choke point", () => {
    // sshCommonOpts / sshDialOpts / nixSshOpts are three renderings of one
    // `keepaliveOpts` call. The check is on that function, not on each of them.
    const forged = forge({ intervalS: 0 });
    const renders: readonly ((k: SshKeepalive) => unknown)[] = [
      sshCommonOpts,
      sshDialOpts,
      nixSshOpts,
    ];
    for (const render of renders)
      expect(() => render(forged)).toThrow(/positive integer/);
  });

  it("still renders a HONESTLY-minted policy, unchanged", () => {
    // The check must cost a valid policy nothing — it is a guard, not a filter.
    expect(sshCommonOpts(sshKeepalive(30, 10))).toContain(
      "ServerAliveInterval=30",
    );
    expect(sshCommonOpts(sshKeepalive(30, 10))).toContain(
      "ServerAliveCountMax=10",
    );
  });
});
