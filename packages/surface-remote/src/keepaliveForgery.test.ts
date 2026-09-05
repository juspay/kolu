/**
 * The two forgeries the BRAND alone does not stop — pinned, because the fix for
 * them is a `renderableKeepalive()` call that reads like a redundant assertion
 * and is exactly the kind of line a later cleanup deletes.
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
 * that this option exists to bound.
 *
 * And a spread can install an ACCESSOR of the declared `readonly number` type,
 * which is why a validating ASSERTION was not enough either:
 *
 *     let reads = 0;
 *     const changing: SshKeepalive = {
 *       ...sshKeepalive(10, 3),
 *       get intervalS() { return ++reads <= 2 ? 10 : 0; },
 *     };
 *
 * Also no cast, also no `any`. Against the assertion-only guard this passed
 * validation (reads 1 and 2), rendered `ServerAliveInterval=0` (read 3), and —
 * on the complete renderers — named a `%C-10x3` socket off a FOURTH read: a
 * master whose identity claims a policy the dial was not running. So the
 * invariant is bought by CAPTURING the numbers once at one boundary and
 * rendering everything downstream from that snapshot, and this file is what
 * breaks if the capture degenerates back into an assertion.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
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

/** A policy whose `intervalS` answers a DIFFERENT number on each read, and a
 *  count of how many times it was asked. `answers` is consumed in order; the
 *  last one repeats. Type-correct: `readonly intervalS: number` is satisfied by
 *  a getter, so this needs no cast either. */
function changingInterval(answers: readonly number[]): {
  policy: SshKeepalive;
  reads: () => number;
} {
  let reads = 0;
  return {
    policy: {
      ...sshKeepalive(10, 3),
      get intervalS(): number {
        const at = Math.min(reads, answers.length - 1);
        reads += 1;
        return answers[at] as number;
      },
    },
    reads: () => reads,
  };
}

/** `ServerAliveInterval=<n>` out of an argv or an env string. */
const interval = (rendered: readonly string[] | string): string | undefined =>
  (typeof rendered === "string" ? rendered.split(" ") : rendered)
    .find((s) => s.startsWith("ServerAliveInterval="))
    ?.slice("ServerAliveInterval=".length);

/** The `%C-<tag>` suffix of the rendered `ControlPath` (undefined when we
 *  refused to multiplex, which the fixture below makes sure we do not). */
const socketTag = (rendered: readonly string[] | string): string | undefined =>
  (typeof rendered === "string" ? rendered.split(" ") : rendered)
    .find((s) => s.startsWith("ControlPath=") && s.includes("%C-"))
    ?.split("%C-")[1];

describe("an ACCESSOR-forged keepalive cannot outrun the check", () => {
  // The complete renderers need a usable control dir or they refuse to
  // multiplex and there is no socket tag to compare against. Short and under
  // `/tmp` for the same reason `controlMaster.test.ts` says: a long
  // `os.tmpdir()` would trip the sun_path guard instead.
  let xdg: string;
  beforeEach(() => {
    xdg = mkdtempSync(join("/tmp", "kolu-forge-"));
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
  });
  afterEach(() => {
    __resetControlMemo();
    vi.unstubAllEnvs();
    rmSync(xdg, { recursive: true, force: true });
  });

  it("reads each field EXACTLY ONCE per render — the whole anti-TOCTOU claim", () => {
    // Against the assertion-only guard this was 3 for `sshCommonOpts` (integer
    // check, product check, render) and 4 for the complete renderers (plus the
    // socket tag). Every read after the first is an opportunity for a getter to
    // change its answer, so the count IS the invariant.
    for (const render of [sshCommonOpts, sshDialOpts, nixSshOpts]) {
      const { policy, reads } = changingInterval([10]);
      render(policy);
      expect(reads()).toBe(1);
    }
  });

  it("never emits ServerAliveInterval=0 for codex's 10,10,0 accessor", () => {
    // The filed reproducer verbatim: valid for the first two reads (the two the
    // assertion made), disabling on the third (the one the renderer made).
    // `ServerAliveInterval=0` does not probe faster — it turns dead-peer
    // detection OFF, which is the eternal half-open park this option bounds.
    for (const render of [sshCommonOpts, sshDialOpts, nixSshOpts]) {
      const { policy } = changingInterval([10, 10, 0]);
      expect(interval(render(policy))).toBe("10");
    }
  });

  it("renders the ServerAlive options and the socket tag from ONE snapshot", () => {
    // The split-master bug: a `%C-10x3` socket carrying `ServerAliveInterval=0`
    // is a master whose identity claims a policy the dial is not running, and
    // the next dial at the real 10x3 policy would silently ride it. Assert the
    // two agree — not that they are any particular number, which is what makes
    // this a claim about the SNAPSHOT rather than about this fixture.
    for (const render of [sshDialOpts, nixSshOpts]) {
      const { policy } = changingInterval([10, 10, 0, 99]);
      const rendered = render(policy);
      const tag = socketTag(rendered);
      expect(tag).toBeDefined();
      expect(tag).toBe(`${interval(rendered)}x3`);
    }
  });

  it("still REJECTS an accessor whose captured value is invalid", () => {
    // Capturing is not trusting: what was read once is still put through the
    // one shared rule, with the constructor's own message.
    const { policy } = changingInterval([0, 10, 10]);
    expect(() => sshDialOpts(policy)).toThrow(
      /intervalS must be a positive integer/,
    );
  });
});
