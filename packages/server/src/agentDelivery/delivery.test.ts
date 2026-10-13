/**
 * The delivery policy on fake Nix steps and fake hosts: what each host's padi
 * is told (delivering, then landed / failed with its cause), how a run ends
 * per host, that upstream's flake is locked ONCE per run (and reused within a
 * schedule period for a host's connect, afresh for the user's check and the
 * schedule), that a profile switch is its own delivery, and that the ONLY
 * route a bundle takes is `ops.deliver` — evaluated per distinct system once,
 * never built (no build op exists to call).
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import type { Logger } from "@kolu/log";
import type { DeliverClosureResult } from "@kolu/surface-remote";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentDelivery,
  type DeliveryHost,
  type DeliveryOps,
} from "./delivery.ts";

const BAKE: AgentDistroDelivery = {
  flake: "github:juspay/agent-distro",
  cache: {
    url: "https://cache.example.org/agent-distro",
    publicKey: "agent-distro-1:AAAAKEY=",
  },
  schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
};

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const at = (iso: string) => Date.parse(iso);

const outPathFor = (ref: string, system: string, profile: string) =>
  `/nix/store/${ref}-${system}-${profile}-bundle`;

/** Fake Nix steps: each records its calls; `deliver` answers from `result`
 *  (per ssh), and can be held open with `hold`. */
function fakeOps(
  opts: {
    systems?: Record<string, string>;
    result?: (
      ssh: string,
      outPath: string,
      profile: string,
    ) => DeliverClosureResult;
    lockFails?: boolean;
  } = {},
) {
  let locks = 0;
  const outPathCalls: string[] = [];
  const delivered: {
    ssh: string;
    system: string;
    outPath: string;
    profile: string;
  }[] = [];
  let gate: Promise<void> | undefined;
  const ops: DeliveryOps = {
    lock: async () => {
      locks++;
      if (opts.lockFails === true)
        throw new Error("unable to download 'https://api.github.com/…'");
      return `ref${locks}`;
    },
    systemOf: async (ssh) => opts.systems?.[ssh] ?? "x86_64-linux",
    outPath: async (ref, system, profile) => {
      outPathCalls.push(`${ref}#${system}.${profile}`);
      return outPathFor(ref, system, profile);
    },
    deliver: async ({ ssh, system, outPath, profile }) => {
      delivered.push({ ssh, system, outPath, profile });
      if (gate !== undefined) await gate;
      return (
        opts.result?.(ssh, outPath, profile) ?? {
          ok: true,
          outPath,
        }
      );
    },
  };
  return {
    ops,
    locks: () => locks,
    outPathCalls,
    delivered,
    /** Hold every `deliver` open until the returned release is called. */
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => {
        release = r;
      });
      return () => {
        gate = undefined;
        release();
      };
    },
  };
}

function fakeHost(key: string, ssh: string, label = ssh) {
  const reports: AgentDistroDeliveryReport[] = [];
  const host: DeliveryHost = {
    key,
    ssh,
    label,
    report: async (r) => {
      reports.push(r);
    },
  };
  return { host, reports };
}

function setup(opts: {
  ops: DeliveryOps;
  hosts: DeliveryHost[];
  bundle?: () => string | undefined;
  now?: () => number;
}) {
  return createAgentDelivery({
    bake: BAKE,
    ops: opts.ops,
    log,
    bundle: opts.bundle ?? (() => "vanilla"),
    hosts: () => opts.hosts,
    now: opts.now ?? (() => at("2026-10-08T09:00:00Z")),
  });
}

describe("createAgentDelivery", () => {
  it("a landed delivery reports delivering, then landed with the outPath", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost", "laptop");
    const delivery = setup({ ops: nix.ops, hosts: [local.host] });
    const outcomes = await delivery.run({ trigger: "user" });
    const out = outPathFor("ref1", "x86_64-linux", "vanilla");
    expect(outcomes).toEqual(["landed"]);
    expect(local.reports).toEqual([
      { kind: "delivering", profile: "vanilla" },
      { kind: "landed", profile: "vanilla", bundle: out },
    ]);
    // The host's system rides to the route: it decides the form the bundle
    // travels in.
    expect(nix.delivered).toEqual([
      {
        ssh: "localhost",
        system: "x86_64-linux",
        outPath: out,
        profile: "vanilla",
      },
    ]);
    expect(delivery.running()).toBe(false);
  });

  it("a Mac whose Nix refuses the signed bundle is a failure with Nix's words and the one-line fix", async () => {
    const nix = fakeOps({
      systems: { "srid@mac": "aarch64-darwin" },
      result: () => ({
        ok: false,
        kind: "not-delivered",
        why: "refused",
        reason: "cannot add path because it lacks a signature by a trusted key",
      }),
    });
    const mac = fakeHost("remote:mac", "srid@mac", "mac");
    const delivery = setup({ ops: nix.ops, hosts: [mac.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(mac.reports.at(-1)).toEqual({
      kind: "failed",
      profile: "vanilla",
      message: `mac's Nix would not take the signed agents: cannot add path because it lacks a signature by a trusted key. On that Mac, add the login kolu connects as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${BAKE.cache.publicKey}) to \`nix.settings.trusted-public-keys\`.`,
    });
  });

  it("a failure is not remembered: a reconnect delivers again", async () => {
    let fail = true;
    const nix = fakeOps({
      result: (_ssh, outPath) =>
        fail
          ? {
              ok: false,
              kind: "not-delivered",
              why: "unshipped",
              reason: "ssh dropped",
            }
          : { ok: true, outPath },
    });
    const box = fakeHost("remote:box", "box");
    const delivery = setup({ ops: nix.ops, hosts: [box.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    fail = false;
    expect(await delivery.run({ trigger: "connect" })).toEqual(["landed"]);
    expect(nix.delivered).toHaveLength(2);
  });

  it("an uncached bundle is a delivery failure, never a build", async () => {
    const nix = fakeOps({
      result: () => ({
        ok: false,
        kind: "not-delivered",
        why: "uncached",
        reason: "path is not valid and no substituter has it",
      }),
    });
    const local = fakeHost("local", "localhost");
    const delivery = setup({ ops: nix.ops, hosts: [local.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    const last = local.reports.at(-1);
    expect(last).toMatchObject({ kind: "failed" });
    const message = last?.kind === "failed" ? last.message : "";
    expect(message).toContain(BAKE.cache.url);
    expect(message).toContain("no substituter has it");
  });

  it("a delivery `failed` (root commit / abort) is a delivery failure", async () => {
    const nix = fakeOps({
      result: () => ({
        ok: false,
        kind: "failed",
        reason: "box: ssh dropped",
        cause: "network",
      }),
    });
    const box = fakeHost("remote:box", "box");
    const delivery = setup({ ops: nix.ops, hosts: [box.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(box.reports.at(-1)).toEqual({
      kind: "failed",
      profile: "vanilla",
      message: "box: ssh dropped",
    });
  });

  it("locks once for a multi-host run, and evaluates each distinct system once", async () => {
    const nix = fakeOps({
      systems: {
        localhost: "x86_64-linux",
        a: "x86_64-linux",
        b: "aarch64-darwin",
      },
    });
    const hosts = [
      fakeHost("local", "localhost"),
      fakeHost("remote:a", "a"),
      fakeHost("remote:b", "b"),
    ];
    const delivery = setup({ ops: nix.ops, hosts: hosts.map((h) => h.host) });
    expect(await delivery.run({ trigger: "user" })).toEqual([
      "landed",
      "landed",
      "landed",
    ]);
    expect(nix.locks()).toBe(1);
    expect([...nix.outPathCalls].sort()).toEqual([
      "ref1#aarch64-darwin.vanilla",
      "ref1#x86_64-linux.vanilla",
    ]);
    // `deliver` is the only route a bundle takes — once per host, each with
    // its own system's evaluated path.
    expect(nix.delivered.map((d) => [d.ssh, d.outPath])).toEqual([
      ["localhost", outPathFor("ref1", "x86_64-linux", "vanilla")],
      ["a", outPathFor("ref1", "x86_64-linux", "vanilla")],
      ["b", outPathFor("ref1", "aarch64-darwin", "vanilla")],
    ]);
  });

  it("reuses the period's lock unless asked afresh, and re-locks in the next period", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    let now = at("2026-10-08T09:00:00Z");
    const delivery = setup({
      ops: nix.ops,
      hosts: [local.host],
      now: () => now,
    });
    await delivery.run({ trigger: "connect" });
    expect(nix.locks()).toBe(1);
    // Same period (08:00–14:00 UTC): a reconnect reuses the lock.
    now = at("2026-10-08T13:00:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.locks()).toBe(1);
    // The user's check locks afresh.
    await delivery.run({ trigger: "user" });
    expect(nix.locks()).toBe(2);
    // Past the 14:00 boundary, even a reconnect re-locks.
    now = at("2026-10-08T14:01:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.locks()).toBe(3);
    // The schedule locks afresh too.
    await delivery.run({ trigger: "schedule" });
    expect(nix.locks()).toBe(4);
    // Evaluation is shared WITHIN a run only, and follows the run's ref.
    expect(nix.outPathCalls).toEqual([
      "ref1#x86_64-linux.vanilla",
      "ref1#x86_64-linux.vanilla",
      "ref2#x86_64-linux.vanilla",
      "ref3#x86_64-linux.vanilla",
      "ref4#x86_64-linux.vanilla",
    ]);
  });

  it("a lock failure fails every host's delivery and never delivers", async () => {
    const nix = fakeOps({ lockFails: true });
    const hosts = [fakeHost("local", "localhost"), fakeHost("remote:a", "a")];
    const delivery = setup({ ops: nix.ops, hosts: hosts.map((h) => h.host) });
    expect(await delivery.run({ trigger: "user" })).toEqual([
      "failed",
      "failed",
    ]);
    for (const h of hosts) {
      expect(h.reports).toEqual([
        { kind: "delivering", profile: "vanilla" },
        {
          kind: "failed",
          profile: "vanilla",
          message: "unable to download 'https://api.github.com/…'",
        },
      ]);
    }
    expect(nix.locks()).toBe(1);
    expect(nix.outPathCalls).toEqual([]);
    expect(nix.delivered).toEqual([]);
  });

  it("is a no-op while agents are off", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const delivery = setup({
      ops: nix.ops,
      hosts: [local.host],
      bundle: () => undefined,
    });
    expect(await delivery.run({ trigger: "user" })).toEqual([]);
    expect(nix.locks()).toBe(0);
    expect(local.reports).toEqual([]);
    expect(nix.delivered).toEqual([]);
  });

  it("a host already being delivered to is busy, and keeps its delivery", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const box = fakeHost("remote:box", "box");
    const delivery = setup({ ops: nix.ops, hosts: [local.host, box.host] });
    const release = nix.hold();
    const first = delivery.run({ keys: ["local"], trigger: "user" });
    await vi.waitFor(() => expect(nix.delivered).toHaveLength(1));
    expect(delivery.running()).toBe(true);
    // A second run over both: local is busy, box is delivered to.
    const second = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.delivered).toHaveLength(2));
    release();
    expect(await first).toEqual(["landed"]);
    expect(await second).toEqual(["busy", "landed"]);
    // local was told ONE delivery's story, not two.
    expect(local.reports.map((r) => r.kind)).toEqual(["delivering", "landed"]);
    expect(delivery.running()).toBe(false);
  });

  it("delivers only to the asked keys", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const box = fakeHost("remote:box", "box");
    const delivery = setup({ ops: nix.ops, hosts: [local.host, box.host] });
    expect(
      await delivery.run({ keys: ["remote:box"], trigger: "user" }),
    ).toEqual(["landed"]);
    expect(local.reports).toEqual([]);
    expect(nix.delivered.map((d) => d.ssh)).toEqual(["box"]);
  });

  it("a host whose padi refuses the start report is failed and not delivered to", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const gone: DeliveryHost = {
      key: "remote:gone",
      ssh: "gone",
      label: "gone",
      report: () => Promise.reject(new Error("padi on gone is not connected")),
    };
    const delivery = setup({ ops: nix.ops, hosts: [gone, local.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual([
      "failed",
      "landed",
    ]);
    expect(nix.delivered.map((d) => d.ssh)).toEqual(["localhost"]);
  });

  it("a profile switch mid-delivery is its own delivery, not busy", async () => {
    const nix = fakeOps();
    const box = fakeHost("remote:box", "box");
    let profile = "vanilla";
    const delivery = setup({
      ops: nix.ops,
      hosts: [box.host],
      bundle: () => profile,
    });
    const release = nix.hold();
    const first = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.delivered).toHaveLength(1));
    profile = "pro";
    const second = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.delivered).toHaveLength(2));
    release();
    expect(await first).toEqual(["landed"]);
    expect(await second).toEqual(["landed"]);
    expect(nix.delivered.map((d) => d.profile)).toEqual(["vanilla", "pro"]);
    // Each delivery told its own profile's story.
    const story = (p: string) =>
      box.reports.filter((r) => r.profile === p).map((r) => r.kind);
    expect(story("vanilla")).toEqual(["delivering", "landed"]);
    expect(story("pro")).toEqual(["delivering", "landed"]);
    expect(box.reports).toContainEqual({
      kind: "landed",
      profile: "pro",
      bundle: outPathFor("ref1", "x86_64-linux", "pro"),
    });
    expect(delivery.running()).toBe(false);
  });
});
