/**
 * The delivery policy on fake steps and fake hosts: what each host's padi is
 * told (delivering, then landed / failed with its cause), how a run ends per
 * host, that upstream's index is read ONCE per system per run (and reused
 * within a schedule period for a host's connect, afresh for the user's check
 * and the schedule), that a profile switch is its own delivery, and that the
 * ONLY route a bundle takes is `ops.pull` of the index's content-addressed
 * path — nothing is evaluated or built (no such op exists to call).
 */

import type { CaIndexEntry } from "@kolu/agent-distro/caIndex";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import type { Logger } from "@kolu/log";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentDelivery,
  type DeliveryHost,
  type DeliveryOps,
} from "./delivery.ts";

const SCHEDULE = { periodSeconds: 21600, offsetSeconds: 7200 };

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const at = (iso: string) => Date.parse(iso);

/** The index's content-addressed path for the `n`th read of a system's
 *  profile bundle. */
const caFor = (n: number, system: string, profile: string) =>
  `/nix/store/ca${n}-${system}-${profile}`;

/** Fake steps: each records its calls; `pull` answers from `result`,
 *  and can be held open with `hold`. */
function fakeOps(
  opts: {
    systems?: Record<string, string>;
    result?: () => Awaited<ReturnType<DeliveryOps["pull"]>>;
    published?: (
      system: string,
      profile: string,
    ) => CaIndexEntry | Error | undefined;
  } = {},
) {
  const reads: string[] = [];
  const pulled: {
    ssh: string;
    system: string;
    storePath: string;
    profile: string;
  }[] = [];
  let gate: Promise<void> | undefined;
  const ops: DeliveryOps = {
    hostNixOf: async (ssh) => ({
      system: opts.systems?.[ssh] ?? "x86_64-linux",
      nixVersion: "2.34.8",
    }),
    published: async (system, profile) => {
      reads.push(`${system}.${profile}`);
      const answer = opts.published?.(system, profile);
      if (answer instanceof Error) throw answer;
      const ca = caFor(reads.length, system, profile);
      return answer ?? { rev: "f".repeat(40), ia: `${ca}-ia`, ca };
    },
    // Which form a host runs is the ops' call (`./route.ts`); this fake lands
    // `ca` and records the system it was told.
    pull: async ({ ssh, hostNix, published, profile }) => {
      const storePath = published.ca ?? published.ia;
      pulled.push({ ssh, system: hostNix.system, storePath, profile });
      if (gate !== undefined) await gate;
      return opts.result?.() ?? { ok: true, bundle: storePath };
    },
  };
  return {
    ops,
    reads,
    pulled,
    /** Hold every `pull` open until the returned release is called. */
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
    schedule: SCHEDULE,
    ops: opts.ops,
    log,
    bundle: opts.bundle ?? (() => "vanilla"),
    hosts: () => opts.hosts,
    now: opts.now ?? (() => at("2026-10-08T09:00:00Z")),
  });
}

describe("createAgentDelivery", () => {
  it("a landed delivery reports delivering, then landed with the index's content-addressed path", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost", "laptop");
    const delivery = setup({ ops: nix.ops, hosts: [local.host] });
    const outcomes = await delivery.run({ trigger: "user" });
    const ca = caFor(1, "x86_64-linux", "vanilla");
    expect(outcomes).toEqual(["landed"]);
    expect(local.reports).toEqual([
      { kind: "delivering", profile: "vanilla" },
      { kind: "landed", profile: "vanilla", bundle: ca },
    ]);
    expect(nix.pulled).toEqual([
      {
        ssh: "localhost",
        system: "x86_64-linux",
        storePath: ca,
        profile: "vanilla",
      },
    ]);
    expect(delivery.running()).toBe(false);
  });

  it("the pull is told the host's system and that system's index entry, and the landing names what it landed", async () => {
    const nix = fakeOps({
      systems: { "srid@mac": "aarch64-darwin" },
      result: () => ({ ok: true, bundle: "/nix/store/signed-ia-bundle" }),
    });
    const mac = fakeHost("remote:mac", "srid@mac", "mac");
    const delivery = setup({ ops: nix.ops, hosts: [mac.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["landed"]);
    expect(nix.reads).toEqual(["aarch64-darwin.vanilla"]);
    expect(nix.pulled[0]).toMatchObject({
      system: "aarch64-darwin",
      storePath: caFor(1, "aarch64-darwin", "vanilla"),
    });
    expect(mac.reports.at(-1)).toEqual({
      kind: "landed",
      profile: "vanilla",
      bundle: "/nix/store/signed-ia-bundle",
    });
  });

  it("a system upstream has not published is a typed failure, and nothing is pulled", async () => {
    const nix = fakeOps({
      systems: { pi: "armv7l-linux" },
      published: (system, profile) =>
        new Error(
          `agent-distro has not published the ${profile} agents for ${system} yet`,
        ),
    });
    const pi = fakeHost("remote:pi", "pi");
    const delivery = setup({ ops: nix.ops, hosts: [pi.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(pi.reports.at(-1)).toEqual({
      kind: "failed",
      profile: "vanilla",
      message:
        "agent-distro has not published the vanilla agents for armv7l-linux yet",
    });
    expect(nix.pulled).toEqual([]);
  });

  it("a failure is not remembered: a reconnect delivers again", async () => {
    let fail = true;
    const nix = fakeOps({
      result: () =>
        fail
          ? { ok: false, message: "ssh dropped" }
          : { ok: true, bundle: "/nix/store/landed" },
    });
    const box = fakeHost("remote:box", "box");
    const delivery = setup({ ops: nix.ops, hosts: [box.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    fail = false;
    expect(await delivery.run({ trigger: "connect" })).toEqual(["landed"]);
    expect(nix.pulled).toHaveLength(2);
  });

  it("a pull that did not land is a delivery failure, in the pull's own words", async () => {
    const nix = fakeOps({
      result: () => ({ ok: false, message: "box: ssh dropped" }),
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

  it("reads the index once per distinct system in a multi-host run", async () => {
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
    expect([...nix.reads].sort()).toEqual([
      "aarch64-darwin.vanilla",
      "x86_64-linux.vanilla",
    ]);
    // `pull` is the only route a bundle takes — once per host, each with its
    // own system's path.
    const linux = nix.pulled.find((p) => p.ssh === "a")?.storePath;
    expect(nix.pulled.find((p) => p.ssh === "localhost")?.storePath).toBe(
      linux,
    );
    expect(nix.pulled.find((p) => p.ssh === "b")?.storePath).toMatch(
      /aarch64-darwin/,
    );
  });

  it("reuses the period's index answer for a connect, reads afresh for the user and the schedule, and re-reads in the next period", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    let now = at("2026-10-08T09:00:00Z");
    const delivery = setup({
      ops: nix.ops,
      hosts: [local.host],
      now: () => now,
    });
    await delivery.run({ trigger: "connect" });
    expect(nix.reads).toHaveLength(1);
    // Same period (08:00–14:00 UTC): a reconnect reuses the answer.
    now = at("2026-10-08T13:00:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.reads).toHaveLength(1);
    // The user's check reads afresh.
    await delivery.run({ trigger: "user" });
    expect(nix.reads).toHaveLength(2);
    // Past the 14:00 boundary, even a reconnect re-reads.
    now = at("2026-10-08T14:01:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.reads).toHaveLength(3);
    // The schedule reads afresh too.
    await delivery.run({ trigger: "schedule" });
    expect(nix.reads).toHaveLength(4);
    // Each landing is the path its run's answer named.
    expect(nix.pulled.map((p) => p.storePath)).toEqual([
      caFor(1, "x86_64-linux", "vanilla"),
      caFor(1, "x86_64-linux", "vanilla"),
      caFor(2, "x86_64-linux", "vanilla"),
      caFor(3, "x86_64-linux", "vanilla"),
      caFor(4, "x86_64-linux", "vanilla"),
    ]);
  });

  it("an index that cannot be read fails every host on that system and never pulls", async () => {
    const nix = fakeOps({
      published: () =>
        new Error("agent-distro's index answered HTTP 503 for https://…"),
    });
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
          message: "agent-distro's index answered HTTP 503 for https://…",
        },
      ]);
    }
    expect(nix.reads).toHaveLength(1);
    expect(nix.pulled).toEqual([]);
  });

  it("a failed read is not reused: the next connect reads again", async () => {
    let down = true;
    const nix = fakeOps({
      published: () => (down ? new Error("HTTP 503") : undefined),
    });
    const local = fakeHost("local", "localhost");
    const delivery = setup({ ops: nix.ops, hosts: [local.host] });
    expect(await delivery.run({ trigger: "connect" })).toEqual(["failed"]);
    down = false;
    expect(await delivery.run({ trigger: "connect" })).toEqual(["landed"]);
    expect(nix.reads).toHaveLength(2);
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
    expect(nix.reads).toEqual([]);
    expect(local.reports).toEqual([]);
    expect(nix.pulled).toEqual([]);
  });

  it("a host already being delivered to is busy, and keeps its delivery", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const box = fakeHost("remote:box", "box");
    const delivery = setup({ ops: nix.ops, hosts: [local.host, box.host] });
    const release = nix.hold();
    const first = delivery.run({ keys: ["local"], trigger: "user" });
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(1));
    expect(delivery.running()).toBe(true);
    // A second run over both: local is busy, box is delivered to.
    const second = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(2));
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
    expect(nix.pulled.map((d) => d.ssh)).toEqual(["box"]);
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
    expect(nix.pulled.map((d) => d.ssh)).toEqual(["localhost"]);
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
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(1));
    profile = "pro";
    const second = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(2));
    release();
    expect(await first).toEqual(["landed"]);
    expect(await second).toEqual(["landed"]);
    expect(nix.pulled.map((d) => d.profile)).toEqual(["vanilla", "pro"]);
    // Each delivery told its own profile's story.
    const story = (p: string) =>
      box.reports.filter((r) => r.profile === p).map((r) => r.kind);
    expect(story("vanilla")).toEqual(["delivering", "landed"]);
    expect(story("pro")).toEqual(["delivering", "landed"]);
    expect(box.reports).toContainEqual({
      kind: "landed",
      profile: "pro",
      bundle: caFor(2, "x86_64-linux", "pro"),
    });
    expect(delivery.running()).toBe(false);
  });
});
