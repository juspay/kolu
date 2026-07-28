/**
 * padi's port-scan policy pins — classification, U-row mapping, subtree walk —
 * against fixture TSV. Live OS proofs live in `scan.live.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { parseSnapshotOutput } from "osfacts-client";
import {
  addressBind,
  decodeNetworkAddress,
  partitionSubtrees,
  sourceErrorsMessage,
  type ProcessRow,
  unreadablePolicy,
} from "./scan.ts";

const V4_MAPPED_LOOPBACK = "00000000000000000000ffff7f000001";
const V4_MAPPED_WILDCARD = "00000000000000000000ffff00000000";

const OSFACTS_OUTPUT = [
  "V\t2",
  "P\t1\t0\tlaunchd",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  "P\t757\t1\tControlCenter",
  "P\t53082\t4200\tnode",
  "L\tclaimed\t757\t501\t7000\t00000000",
  "L\tclaimed\t53082\t501\t5173\t00000000000000000000000000000001",
  `L\tclaimed\t53082\t501\t8081\t${V4_MAPPED_LOOPBACK}`,
  `L\tclaimed\t53082\t501\t8082\t${V4_MAPPED_WILDCARD}`,
  "L\tclaimed\t53082\t501\t8078\tc0a80105",
  "L\tunclaimed\t-\t0\t22\t00000000",
  "",
].join("\n");

describe("decodeNetworkAddress", () => {
  it("reads network-order v4", () => {
    expect(decodeNetworkAddress("7f000001")).toEqual([127, 0, 0, 1]);
  });

  it("leaves the address format rule to the client, which owns it", () => {
    // padi used to re-check "exactly 8 or 32 hex digits" here. The client
    // already refuses such an `L` row, and the two copies had drifted — the
    // client narrowed to lowercase while this one still accepted `[A-F]`.
    // Same argument as the port rule in `classifyListeners`: a second copy is
    // unreachable and would have to be found twice to relax.
    expect(() =>
      parseSnapshotOutput("V\t2\nL\tclaimed\t1\t-\t8080\t00FF\n"),
    ).toThrow();
  });
});

describe("addressBind", () => {
  it("classifies any / loopback / interface for v4", () => {
    expect(addressBind([0, 0, 0, 0])).toEqual({ scope: "any", family: "v4" });
    expect(addressBind([127, 0, 0, 1])).toEqual({
      scope: "loopback",
      family: "v4",
    });
    expect(addressBind([192, 168, 1, 5])).toEqual({
      scope: "interface",
      family: "v4",
    });
  });

  it("classifies v4-mapped through the same judge", () => {
    expect(addressBind(decodeNetworkAddress(V4_MAPPED_WILDCARD)).scope).toBe(
      "any",
    );
    expect(addressBind(decodeNetworkAddress(V4_MAPPED_LOOPBACK)).scope).toBe(
      "loopback",
    );
  });

  it("classifies v6 any and loopback", () => {
    expect(addressBind(new Array(16).fill(0))).toEqual({
      scope: "any",
      family: "v6",
    });
    const loop = new Array(16).fill(0);
    loop[15] = 1;
    expect(addressBind(loop)).toEqual({ scope: "loopback", family: "v6" });
  });
});

describe("parse + classify (client raw → padi policy)", () => {
  it("judges each bind through addressBind", () => {
    const { ports } = parseSnapshotOutput(OSFACTS_OUTPUT);
    const classified = ports.flatMap((l) =>
      l.status === "unclaimed"
        ? []
        : [
            {
              pid: l.pid,
              port: l.port,
              ...addressBind(decodeNetworkAddress(l.address)),
            },
          ],
    );
    expect(classified).toContainEqual({
      pid: 757,
      port: 7000,
      scope: "any",
      family: "v4",
    });
    expect(classified).toContainEqual({
      pid: 53082,
      port: 5173,
      scope: "loopback",
      family: "v6",
    });
    expect(classified).toContainEqual({
      pid: 53082,
      port: 8081,
      scope: "loopback",
      family: "v4",
    });
    expect(classified).toContainEqual({
      pid: 53082,
      port: 8078,
      scope: "interface",
      family: "v4",
    });
  });
});

describe("unreadablePolicy", () => {
  it("skips a foreign-uid DESCENDANT rather than blinding the whole host", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 991, facet: "ports", errno: "EACCES" }],
      new Set([4200]),
    );
    expect(fatal).toBeNull();
    expect([...skipPids]).toEqual([991]);
  });

  it("is fatal when a requested root is EACCES/EPERM", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 4200, facet: "ports", errno: "EPERM" }],
      new Set([4200]),
    );
    expect(fatal).toEqual({ pid: 4200, facet: "ports", errno: "EPERM" });
    expect(skipPids.size).toBe(0);
  });

  it("treats a vanished requested root as skip (empty ports), not blind", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 9999, facet: "proc", errno: "ENOENT" }],
      new Set([9999]),
    );
    expect(fatal).toBeNull();
    expect([...skipPids]).toEqual([9999]);
  });

  it("skips U rows outside the ask rather than making them fatal", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 1, facet: "ports", errno: "EPERM" }],
      new Set([4200]),
    );
    expect(fatal).toBeNull();
    expect([...skipPids]).toEqual([1]);
  });

  it("ignores unreadability from unrelated facets", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 4200, facet: "mem", errno: "EACCES" }],
      new Set([4200]),
    );
    expect(fatal).toBeNull();
    expect(skipPids.size).toBe(0);
  });
});

describe("sourceErrorsMessage", () => {
  it("keeps a blind listener source fatal for padi", () => {
    expect(
      sourceErrorsMessage([
        { source: "proc_net_tcp", facet: "ports", code: "EACCES" },
      ]),
    ).toBe("proc_net_tcp[ports]=EACCES");
    expect(sourceErrorsMessage([])).toBeNull();
  });

  it("survives macOS 27 hiding the host-wide socket table", () => {
    // The fd walk still named every claimed listener, so the only facet lost
    // is the one a subtree fold never reads. Treating this as blindness once
    // blacked out port detection on the whole platform.
    expect(
      sourceErrorsMessage([
        {
          source: "darwin_tcp_pcblist",
          facet: "ports_unclaimed",
          code: "BLIND_OR_EMPTY",
        },
      ]),
    ).toBeNull();
  });

  it("ignores blindness in facets this scan never reads", () => {
    // `net`/`load` used to stand here. Splitting the reading by verb made them
    // unrepresentable in a snapshot's errors — which is the point: this scan
    // can no longer match a host facet by accident. These are snapshot facets
    // the ask genuinely does not name.
    expect(
      sourceErrorsMessage([
        { source: "sysconf_pagesize", facet: "mem", code: "EIO" },
        { source: "sysconf_clk_tck", facet: "cpu_time", code: "EIO" },
      ]),
    ).toBeNull();
  });

  it("tolerates the darwin listener honesty rows the ask does name", () => {
    // `ports_uid` is unconditional on darwin: neither listener source carries
    // a socket's owning uid. It costs this fold no fact, so it must not blind
    // port detection on the whole platform.
    expect(
      sourceErrorsMessage([
        { source: "darwin_listeners", facet: "ports_uid", code: "ENOTSUP" },
      ]),
    ).toBeNull();
  });

  it("still reports the blinding facet when it arrives beside a benign one", () => {
    expect(
      sourceErrorsMessage([
        {
          source: "darwin_tcp_pcblist",
          facet: "ports_unclaimed",
          code: "BLIND_OR_EMPTY",
        },
        { source: "kern_proc_all", facet: "proc", code: "EPERM" },
      ]),
    ).toBe("kern_proc_all[proc]=EPERM");
  });
});

describe("partitionSubtrees", () => {
  const table: ProcessRow[] = [
    { pid: 1, ppid: 0, name: "init" },
    { pid: 100, ppid: 1, name: "bash" },
    { pid: 200, ppid: 100, name: "node" },
    { pid: 300, ppid: 200, name: "workerd" },
    { pid: 400, ppid: 1, name: "zsh" },
    { pid: 500, ppid: 400, name: "vite" },
  ];

  it("walks grandchildren, and keeps sibling subtrees apart", () => {
    const subtrees = partitionSubtrees(table, [100, 400]);
    expect([...subtrees.get(100)!].sort()).toEqual([100, 200, 300]);
    expect([...subtrees.get(400)!].sort()).toEqual([400, 500]);
  });

  it("gives a dead root an empty subtree rather than omitting the key", () => {
    const subtrees = partitionSubtrees(table, [9999]);
    expect(subtrees.has(9999)).toBe(true);
    expect(subtrees.get(9999)!.size).toBe(0);
  });

  it("terminates on a cyclic ppid chain instead of overflowing the stack", () => {
    const cyclic: ProcessRow[] = [
      { pid: 10, ppid: 11, name: "a" },
      { pid: 11, ppid: 10, name: "b" },
    ];
    const subtrees = partitionSubtrees(cyclic, [10]);
    expect([...subtrees.get(10)!].sort()).toEqual([10, 11]);
  });
});
