/**
 * The delivery policy on fake steps and fake hosts: what each host's padi is
 * told (delivering, then landed with the package and every delivered profile,
 * or failed with its cause), how a run ends per host, how each profile of the
 * stack is locked, built for the host's system at the package's revision,
 * shipped, and only then the package pulled; that a profile that will not
 * lock, build or ship fails that host in words naming it; what Settings is
 * told of each profile (`onResolution`); that upstream's index and each lock
 * are read ONCE per run (and reused within a schedule period for a host's
 * connect, afresh for the user's check and the schedule); that a build is
 * remembered by revision, tree and system; that a stack change is its own
 * delivery, the outdated run ending superseded; and that a re-check keeps the
 * answers Settings already has.
 */

import { referencesOf } from "@kolu/agent-distro/landing";
import type { AgentProfiles } from "@kolu/agent-distro/schema";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import type { Logger } from "@kolu/log";
import type { PublishedClosure } from "@kolu/surface-remote";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentDelivery,
  type DeliveryHost,
  type DeliveryOps,
} from "./delivery.ts";
import type { BuiltProfile, LockedProfile } from "./profiles.ts";

const SCHEDULE = { periodSeconds: 21600, offsetSeconds: 7200 };

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const at = (iso: string) => Date.parse(iso);

const REV = "f".repeat(40);

/** The index's content-addressed path for the `n`th read of a system's
 *  package. */
const caFor = (n: number, system: string) => `/nix/store/ca${n}-${system}`;

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-");

/** The profile's name a fake build gives it: its reference's last part. */
const nameOf = (reference: string) => reference.split(/[/:]/).at(-1) ?? "";

/** The path a fake build lands at for these inputs. */
const builtPath = (rev: string, tree: string, system: string) =>
  `/nix/store/built-${system}-${slug(tree)}-${rev.slice(0, 4)}`;

/** The tree a fake lock pins a flake reference to (stable unless `lock` says
 *  otherwise); a path is its own tree, with no revision. */
const treeOf = (reference: string) =>
  reference.startsWith("/") ? reference : `/nix/store/src-${slug(reference)}`;
const LOCKED_REV = "a".repeat(40);

/** Fake steps: each records its calls; `pull` answers from `result`, and can
 *  be held open with `hold`. */
function fakeOps(
  opts: {
    systems?: Record<string, string>;
    result?: () => Awaited<ReturnType<DeliveryOps["pull"]>>;
    published?: (system: string) => PublishedClosure | Error | undefined;
    lock?: (reference: string) => LockedProfile | Error | undefined;
    build?: (args: {
      rev: string;
      locked: LockedProfile;
      hostSystem: string;
    }) => BuiltProfile | Error | undefined;
    ship?: (args: {
      ssh: string;
      reference: string;
      path: string;
    }) => Awaited<ReturnType<DeliveryOps["ship"]>> | undefined;
  } = {},
) {
  const reads: string[] = [];
  const locks: string[] = [];
  const builds: { rev: string; tree: string; hostSystem: string }[] = [];
  const shipped: {
    ssh: string;
    system: string;
    reference: string;
    path: string;
  }[] = [];
  const pulled: { ssh: string; system: string; storePath: string }[] = [];
  /** Every step in the order it was asked, as `op:subject`. */
  const steps: string[] = [];
  let gate: Promise<void> | undefined;
  const ops: DeliveryOps = {
    hostNixOf: async (ssh) => ({
      system: opts.systems?.[ssh] ?? "x86_64-linux",
      nixVersion: "2.34.8",
    }),
    published: async (system) => {
      reads.push(system);
      const answer = opts.published?.(system);
      if (answer instanceof Error) throw answer;
      const ca = caFor(reads.length, system);
      return answer ?? { rev: REV, ia: `${ca}-ia`, ca };
    },
    lock: async (reference) => {
      locks.push(reference);
      const answer = opts.lock?.(reference);
      if (answer instanceof Error) throw answer;
      return (
        answer ??
        (reference.startsWith("/")
          ? { reference, tree: reference }
          : { reference, tree: treeOf(reference), rev: LOCKED_REV })
      );
    },
    build: async (args) => {
      builds.push({
        rev: args.rev,
        tree: args.locked.tree,
        hostSystem: args.hostSystem,
      });
      const answer = opts.build?.(args);
      if (answer instanceof Error) throw answer;
      const name = nameOf(args.locked.reference);
      return (
        answer ?? {
          path: builtPath(args.rev, args.locked.tree, args.hostSystem),
          name,
          description: `The ${name} profile`,
        }
      );
    },
    ship: async ({ ssh, hostNix, reference, path }) => {
      shipped.push({ ssh, system: hostNix.system, reference, path });
      steps.push(`ship:${ssh}:${reference}`);
      return (
        opts.ship?.({ ssh, reference, path }) ?? {
          ok: true,
          path: `${path}-on-${ssh}`,
        }
      );
    },
    // Which form a host runs is the ops' call (`closureRoute`,
    // `@kolu/surface-remote`); this fake lands `ca`.
    pull: async ({ ssh, hostNix, published }) => {
      const storePath = published.ca ?? published.ia;
      pulled.push({ ssh, system: hostNix.system, storePath });
      steps.push(`pull:${ssh}`);
      if (gate !== undefined) await gate;
      return opts.result?.() ?? { ok: true, bundle: storePath };
    },
  };
  return {
    ops,
    reads,
    locks,
    builds,
    shipped,
    pulled,
    steps,
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
  stack?: () => readonly string[] | undefined;
  now?: () => number;
}) {
  const resolutions: AgentProfiles[] = [];
  const delivery = createAgentDelivery({
    schedule: SCHEDULE,
    ops: opts.ops,
    log,
    stack: opts.stack ?? (() => []),
    hosts: () => opts.hosts,
    onResolution: (profiles) => {
      resolutions.push(profiles);
    },
    now: opts.now ?? (() => at("2026-10-08T09:00:00Z")),
  });
  return { delivery, resolutions };
}

const JUSPAY = "github:juspay/skills";
const MINE = "/home/me/my-profile";

describe("createAgentDelivery — the package", () => {
  it("an empty stack lands the package alone: delivering, then landed with no profile", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost", "laptop");
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [local.host],
    });
    const outcomes = await delivery.run({ trigger: "user" });
    const ca = caFor(1, "x86_64-linux");
    expect(outcomes).toEqual(["landed"]);
    expect(local.reports).toEqual([
      { kind: "delivering", profiles: [] },
      { kind: "landed", set: { bundle: ca, profiles: [] } },
    ]);
    expect(nix.pulled).toEqual([
      { ssh: "localhost", system: "x86_64-linux", storePath: ca },
    ]);
    expect(nix.locks).toEqual([]);
    expect(nix.builds).toEqual([]);
    expect(nix.shipped).toEqual([]);
    // Settings is told there is no profile to resolve.
    expect(resolutions).toEqual([[]]);
    expect(delivery.running()).toBe(false);
  });

  it("the pull is told the host's system and that system's index entry, and the landing names what it landed", async () => {
    const nix = fakeOps({
      systems: { "srid@mac": "aarch64-darwin" },
      result: () => ({ ok: true, bundle: "/nix/store/signed-ia-bundle" }),
    });
    const mac = fakeHost("remote:mac", "srid@mac", "mac");
    const { delivery } = setup({ ops: nix.ops, hosts: [mac.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["landed"]);
    expect(nix.reads).toEqual(["aarch64-darwin"]);
    expect(nix.pulled[0]).toMatchObject({
      system: "aarch64-darwin",
      storePath: caFor(1, "aarch64-darwin"),
    });
    expect(mac.reports.at(-1)).toEqual({
      kind: "landed",
      set: { bundle: "/nix/store/signed-ia-bundle", profiles: [] },
    });
  });

  it("a system upstream has not published is a failure in its words, and nothing is pulled", async () => {
    const nix = fakeOps({
      systems: { pi: "armv7l-linux" },
      published: (system) =>
        new Error(
          `agent-distro has not published its agents for ${system} yet`,
        ),
    });
    const pi = fakeHost("remote:pi", "pi");
    const { delivery } = setup({ ops: nix.ops, hosts: [pi.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(pi.reports.at(-1)).toEqual({
      kind: "failed",
      profiles: [],
      message: "agent-distro has not published its agents for armv7l-linux yet",
    });
    expect(nix.pulled).toEqual([]);
  });

  it("a pull that did not land is a delivery failure, in the pull's own words", async () => {
    const nix = fakeOps({
      result: () => ({ ok: false, message: "box: ssh dropped" }),
    });
    const box = fakeHost("remote:box", "box");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [box.host],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(box.reports.at(-1)).toEqual({
      kind: "failed",
      profiles: [JUSPAY],
      message: "box: ssh dropped",
    });
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
    const { delivery } = setup({ ops: nix.ops, hosts: [box.host] });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    fail = false;
    expect(await delivery.run({ trigger: "connect" })).toEqual(["landed"]);
    expect(nix.pulled).toHaveLength(2);
  });

  it("an index that cannot be read fails every host on that system and never pulls", async () => {
    const nix = fakeOps({
      published: () =>
        new Error("agent-distro's index answered HTTP 503 for https://…"),
    });
    const hosts = [fakeHost("local", "localhost"), fakeHost("remote:a", "a")];
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: hosts.map((h) => h.host),
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual([
      "failed",
      "failed",
    ]);
    for (const h of hosts) {
      expect(h.reports).toEqual([
        { kind: "delivering", profiles: [JUSPAY] },
        {
          kind: "failed",
          profiles: [JUSPAY],
          message: "agent-distro's index answered HTTP 503 for https://…",
        },
      ]);
    }
    // One read for the whole run — Settings' resolution and every host share
    // it, failed as it is, so they all see the same answer.
    expect(nix.reads).toEqual(["x86_64-linux"]);
    expect(nix.builds).toEqual([]);
    expect(nix.pulled).toEqual([]);
    // No profile can be built here, and Settings says why.
    expect(resolutions.at(-1)).toEqual([
      {
        reference: JUSPAY,
        resolution: {
          kind: "failed",
          message: "agent-distro's index answered HTTP 503 for https://…",
        },
      },
    ]);
  });

  it("is a no-op while agents are off, and Settings is told there is nothing to resolve", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [local.host],
      stack: () => undefined,
    });
    expect(await delivery.run({ trigger: "user" })).toEqual([]);
    await delivery.resolve();
    expect(resolutions).toEqual([[]]);
    expect(nix.reads).toEqual([]);
    expect(nix.locks).toEqual([]);
    expect(local.reports).toEqual([]);
    expect(nix.pulled).toEqual([]);
  });
});

describe("createAgentDelivery — the profiles", () => {
  it("locks, builds for the host's system at the package's revision, and ships each profile in stack order — then pulls the package and reports them all", async () => {
    const nix = fakeOps({ systems: { box: "aarch64-linux" } });
    const box = fakeHost("remote:box", "box");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [box.host],
      stack: () => [JUSPAY, MINE],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual(["landed"]);
    // Each profile is built for the host's system with agent-distro at the
    // revision the host's package was published at.
    expect(nix.builds).toContainEqual({
      rev: REV,
      tree: treeOf(JUSPAY),
      hostSystem: "aarch64-linux",
    });
    expect(nix.builds).toContainEqual({
      rev: REV,
      tree: MINE,
      hostSystem: "aarch64-linux",
    });
    // Shipped in stack order, every one before the package is pulled.
    expect(nix.steps).toEqual([
      `ship:box:${JUSPAY}`,
      `ship:box:${MINE}`,
      "pull:box",
    ]);
    const juspayPath = builtPath(REV, treeOf(JUSPAY), "aarch64-linux");
    const minePath = builtPath(REV, MINE, "aarch64-linux");
    expect(nix.shipped.map((s) => s.path)).toEqual([juspayPath, minePath]);
    expect(box.reports.at(-1)).toEqual({
      kind: "landed",
      set: {
        bundle: caFor(nix.reads.indexOf("aarch64-linux") + 1, "aarch64-linux"),
        profiles: [
          // The path is the one the host has (`ship`'s answer); a path
          // reference has no revision.
          {
            reference: JUSPAY,
            name: "skills",
            rev: LOCKED_REV,
            path: `${juspayPath}-on-box`,
          },
          { reference: MINE, name: "my-profile", path: `${minePath}-on-box` },
        ],
      },
    });
  });

  it("tells Settings each profile is pending, then what it resolved to — built for this machine's own system", async () => {
    const nix = fakeOps({ systems: { mac: "aarch64-darwin" } });
    const mac = fakeHost("remote:mac", "mac");
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [mac.host],
      stack: () => [JUSPAY, MINE],
    });
    await delivery.run({ trigger: "connect" });
    expect(resolutions[0]).toEqual([
      { reference: JUSPAY, resolution: { kind: "pending" } },
      { reference: MINE, resolution: { kind: "pending" } },
    ]);
    expect(resolutions.at(-1)).toEqual([
      {
        reference: JUSPAY,
        resolution: {
          kind: "resolved",
          name: "skills",
          description: "The skills profile",
          rev: LOCKED_REV,
        },
      },
      {
        reference: MINE,
        resolution: {
          kind: "resolved",
          name: "my-profile",
          description: "The my-profile profile",
        },
      },
    ]);
    // The resolution builds for this machine (localhost: x86_64-linux), the
    // delivery for the Mac — each system's index read once.
    expect([...nix.reads].sort()).toEqual(["aarch64-darwin", "x86_64-linux"]);
    expect(
      nix.builds.filter((b) => b.hostSystem === "x86_64-linux"),
    ).toHaveLength(2);
    expect(
      nix.builds.filter((b) => b.hostSystem === "aarch64-darwin"),
    ).toHaveLength(2);
  });

  it("a profile that will not build fails that host, naming the reference — and nothing past it ships, nor is the package pulled", async () => {
    const BAD = "github:me/broken";
    const nix = fakeOps({
      build: ({ locked }) =>
        locked.reference === BAD
          ? new Error(
              `cannot build ${BAD} for x86_64-linux: error: attribute 'x' missing`,
            )
          : undefined,
    });
    const box = fakeHost("remote:box", "box");
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [box.host],
      stack: () => [JUSPAY, BAD, MINE],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(box.reports.at(-1)).toEqual({
      kind: "failed",
      profiles: [JUSPAY, BAD, MINE],
      message: `the ${BAD} profile: cannot build ${BAD} for x86_64-linux: error: attribute 'x' missing`,
    });
    expect(nix.shipped.map((s) => s.reference)).toEqual([JUSPAY]);
    expect(nix.pulled).toEqual([]);
    // Settings says it under that profile alone.
    const last = resolutions.at(-1) ?? [];
    expect(last.map((p) => p.resolution.kind)).toEqual([
      "resolved",
      "failed",
      "resolved",
    ]);
    expect(last[1]?.resolution).toEqual({
      kind: "failed",
      message: `cannot build ${BAD} for x86_64-linux: error: attribute 'x' missing`,
    });
  });

  it("a profile that will not lock fails that host, naming the reference", async () => {
    const nix = fakeOps({
      lock: (reference) =>
        reference === JUSPAY
          ? new Error(`cannot fetch ${JUSPAY}: error: HTTP 404`)
          : undefined,
    });
    const box = fakeHost("remote:box", "box");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [box.host],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(box.reports.at(-1)).toEqual({
      kind: "failed",
      profiles: [JUSPAY],
      message: `the ${JUSPAY} profile: cannot fetch ${JUSPAY}: error: HTTP 404`,
    });
    expect(nix.builds).toEqual([]);
    expect(nix.pulled).toEqual([]);
  });

  it("a profile the host will not take fails that host, naming the profile, and the package is not pulled", async () => {
    const nix = fakeOps({
      ship: () => ({ ok: false, message: "mac could not take /nix/store/…" }),
    });
    const mac = fakeHost("remote:mac", "mac");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [mac.host],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual(["failed"]);
    expect(mac.reports.at(-1)).toEqual({
      kind: "failed",
      profiles: [JUSPAY],
      message: "the skills profile: mac could not take /nix/store/…",
    });
    expect(nix.pulled).toEqual([]);
  });

  it("resolve() says whether each profile builds, reusing the period's answers", async () => {
    const nix = fakeOps();
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [],
      stack: () => [JUSPAY],
    });
    await delivery.resolve();
    expect(resolutions.at(-1)).toEqual([
      {
        reference: JUSPAY,
        resolution: {
          kind: "resolved",
          name: "skills",
          description: "The skills profile",
          rev: LOCKED_REV,
        },
      },
    ]);
    await delivery.resolve();
    expect(nix.reads).toHaveLength(1);
    expect(nix.locks).toEqual([JUSPAY]);
    expect(nix.builds).toHaveLength(1);
  });

  it("a run that reaches no host still tells Settings whether each profile builds", async () => {
    const nix = fakeOps();
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual([]);
    expect(resolutions.at(-1)?.[0]?.resolution.kind).toBe("resolved");
  });
});

describe("createAgentDelivery — reads and builds, each asked once", () => {
  it("one run reads the index once per system and locks each reference once, across hosts and Settings' resolution", async () => {
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
    const { delivery } = setup({
      ops: nix.ops,
      hosts: hosts.map((h) => h.host),
      stack: () => [JUSPAY, MINE],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual([
      "landed",
      "landed",
      "landed",
    ]);
    expect([...nix.reads].sort()).toEqual(["aarch64-darwin", "x86_64-linux"]);
    expect([...nix.locks].sort()).toEqual([JUSPAY, MINE].sort());
    // One build per profile per system: the two Linux hosts and this
    // machine's resolution share theirs.
    expect(nix.builds).toHaveLength(4);
    // Each host is shipped each profile, and pulls its own system's path.
    expect(nix.shipped).toHaveLength(6);
    const linux = nix.pulled.find((p) => p.ssh === "a")?.storePath;
    expect(nix.pulled.find((p) => p.ssh === "localhost")?.storePath).toBe(
      linux,
    );
    expect(nix.pulled.find((p) => p.ssh === "b")?.storePath).toMatch(
      /aarch64-darwin/,
    );
  });

  it("a connect reuses the period's index and locks; the user and the schedule read afresh; the next period re-reads", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    let now = at("2026-10-08T09:00:00Z");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [local.host],
      stack: () => [JUSPAY],
      now: () => now,
    });
    await delivery.run({ trigger: "connect" });
    expect(nix.reads).toHaveLength(1);
    expect(nix.locks).toHaveLength(1);
    // Same period (08:00–14:00 UTC): a reconnect reuses both answers.
    now = at("2026-10-08T13:00:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.reads).toHaveLength(1);
    expect(nix.locks).toHaveLength(1);
    // The user's check reads and locks afresh.
    await delivery.run({ trigger: "user" });
    expect(nix.reads).toHaveLength(2);
    expect(nix.locks).toHaveLength(2);
    // Past the 14:00 boundary, even a reconnect re-reads.
    now = at("2026-10-08T14:01:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.reads).toHaveLength(3);
    expect(nix.locks).toHaveLength(3);
    // The schedule reads afresh too — even within the period, an answer asked
    // before it started is not its own.
    now = at("2026-10-08T14:02:00Z");
    await delivery.run({ trigger: "schedule" });
    expect(nix.reads).toHaveLength(4);
    expect(nix.locks).toHaveLength(4);
    // Each landing is the path its run's answer named.
    expect(nix.pulled.map((p) => p.storePath)).toEqual([
      caFor(1, "x86_64-linux"),
      caFor(1, "x86_64-linux"),
      caFor(2, "x86_64-linux"),
      caFor(3, "x86_64-linux"),
      caFor(4, "x86_64-linux"),
    ]);
  });

  it("a failed read is not reused: the next connect reads again", async () => {
    let down = true;
    const nix = fakeOps({
      published: () => (down ? new Error("HTTP 503") : undefined),
    });
    const local = fakeHost("local", "localhost");
    const { delivery } = setup({ ops: nix.ops, hosts: [local.host] });
    expect(await delivery.run({ trigger: "connect" })).toEqual(["failed"]);
    down = false;
    expect(await delivery.run({ trigger: "connect" })).toEqual(["landed"]);
    expect(nix.reads).toHaveLength(2);
  });

  it("a build is reused like the index and locks: a connect within the period builds nothing, a check rebuilds — an edited path profile is picked up", async () => {
    let tree = "/nix/store/src-one";
    let rev = REV;
    let now = at("2026-10-08T09:00:00Z");
    const nix = fakeOps({
      lock: (reference) => ({ reference, tree, rev: LOCKED_REV }),
      published: () => ({ rev, ia: "/nix/store/pkg-ia", ca: "/nix/store/pkg" }),
    });
    const local = fakeHost("local", "localhost");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [local.host],
      stack: () => [JUSPAY],
      now: () => now,
    });
    await delivery.run({ trigger: "connect" });
    expect(nix.builds).toEqual([
      { rev: REV, tree: "/nix/store/src-one", hostSystem: "x86_64-linux" },
    ]);
    // A reconnect in the same period reuses the build (and the lock).
    now = at("2026-10-08T13:00:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.builds).toHaveLength(1);
    // The user's check builds again, whatever the tree: a path profile's tree
    // is a directory that changes under the same key.
    await delivery.run({ trigger: "user" });
    expect(nix.builds).toHaveLength(2);
    // A new tree or a new package revision is a new build too.
    tree = "/nix/store/src-two";
    rev = "e".repeat(40);
    now = at("2026-10-08T14:01:00Z");
    await delivery.run({ trigger: "connect" });
    expect(nix.builds.at(-1)).toEqual({
      rev,
      tree: "/nix/store/src-two",
      hostSystem: "x86_64-linux",
    });
    expect(nix.builds).toHaveLength(3);
  });

  it("two runs that overlap (one per host's connect) share one build, one lock and one read", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const box = fakeHost("remote:box", "box");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [local.host, box.host],
      stack: () => [JUSPAY],
    });
    await Promise.all([
      delivery.run({ keys: ["local"], trigger: "connect" }),
      delivery.run({ keys: ["remote:box"], trigger: "connect" }),
    ]);
    expect(nix.reads).toHaveLength(1);
    expect(nix.locks).toHaveLength(1);
    expect(nix.builds).toHaveLength(1);
  });

  it("a failed build is asked again next time", async () => {
    let broken = true;
    const nix = fakeOps({
      build: () => (broken ? new Error("cannot build: network") : undefined),
    });
    const local = fakeHost("local", "localhost");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [local.host],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "connect" })).toEqual(["failed"]);
    const failedBuilds = nix.builds.length;
    broken = false;
    expect(await delivery.run({ trigger: "connect" })).toEqual(["landed"]);
    expect(nix.builds.length).toBeGreaterThan(failedBuilds);
    // A build that succeeded is reused within the period: a third connect
    // builds nothing.
    const built = nix.builds.length;
    await delivery.run({ trigger: "connect" });
    expect(nix.builds).toHaveLength(built);
  });
});

describe("createAgentDelivery — a re-check keeps what Settings knows", () => {
  it("a profile that built shows its answer while a fresh run asks again — never `pending` again", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [local.host],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual(["landed"]);
    expect(resolutions[0]).toEqual([
      { reference: JUSPAY, resolution: { kind: "pending" } },
    ]);
    const answered = resolutions.at(-1);
    expect(answered?.[0]?.resolution.kind).toBe("resolved");
    const before = resolutions.length;
    // The schedule's run asks afresh: every publish it makes says resolved.
    expect(await delivery.run({ trigger: "schedule" })).toEqual(["landed"]);
    const again = resolutions.slice(before);
    expect(again.length).toBeGreaterThan(0);
    for (const profiles of again)
      expect(profiles[0]?.resolution.kind).toBe("resolved");
  });
});

describe("createAgentDelivery — hosts and runs", () => {
  it("a host already being delivered to is busy, and keeps its delivery", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const box = fakeHost("remote:box", "box");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [local.host, box.host],
    });
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

  it("a run the setting moved on from while it ran is superseded: no landing, no failure, nothing for Settings", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    let stack: readonly string[] = [];
    const { delivery, resolutions } = setup({
      ops: nix.ops,
      hosts: [local.host],
      stack: () => stack,
    });
    const release = nix.hold();
    // The switch turned on with an empty list; its run is pulling the package
    // when Juspay is added.
    const stale = delivery.run({ trigger: "user" });
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(1));
    stack = [JUSPAY];
    const published = resolutions.length;
    release();
    expect(await stale).toEqual(["superseded"]);
    // padi would refuse a landing for [] now: none is reported, and no
    // failure either — the newer stack's run delivers.
    expect(local.reports).toEqual([{ kind: "delivering", profiles: [] }]);
    expect(resolutions).toHaveLength(published);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("delivers only to the asked keys", async () => {
    const nix = fakeOps();
    const local = fakeHost("local", "localhost");
    const box = fakeHost("remote:box", "box");
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [local.host, box.host],
    });
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
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [gone, local.host],
      stack: () => [JUSPAY],
    });
    expect(await delivery.run({ trigger: "user" })).toEqual([
      "failed",
      "landed",
    ]);
    expect(nix.pulled.map((d) => d.ssh)).toEqual(["localhost"]);
    expect(nix.shipped.map((d) => d.ssh)).toEqual(["localhost"]);
  });

  it("a stack change mid-delivery is its own delivery, not busy", async () => {
    const nix = fakeOps();
    const box = fakeHost("remote:box", "box");
    let stack: readonly string[] = [];
    const { delivery } = setup({
      ops: nix.ops,
      hosts: [box.host],
      stack: () => stack,
    });
    const release = nix.hold();
    const first = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(1));
    stack = [JUSPAY];
    const second = delivery.run({ trigger: "connect" });
    await vi.waitFor(() => expect(nix.pulled).toHaveLength(2));
    release();
    // The first run's stack is no longer the setting's: superseded, its
    // landing never reported (padi would refuse it).
    expect(await first).toEqual(["superseded"]);
    expect(await second).toEqual(["landed"]);
    // Each delivery told its own stack's story.
    const stackOf = (r: AgentDistroDeliveryReport) =>
      r.kind === "landed" ? referencesOf(r.set.profiles) : r.profiles;
    const story = (s: readonly string[]) =>
      box.reports
        .filter((r) => JSON.stringify(stackOf(r)) === JSON.stringify(s))
        .map((r) => r.kind);
    expect(story([])).toEqual(["delivering"]);
    expect(story([JUSPAY])).toEqual(["delivering", "landed"]);
    expect(box.reports.at(-1)).toMatchObject({
      kind: "landed",
      set: { profiles: [{ reference: JUSPAY, name: "skills" }] },
    });
    expect(delivery.running()).toBe(false);
  });
});
