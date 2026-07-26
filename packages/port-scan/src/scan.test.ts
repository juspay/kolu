/**
 * The port scan's PARSERS, against fixture osfacts TSV — the half of the
 * scanner that can be pinned without an OS.
 *
 * Every fixture reproduces a subtlety that shipped as a wrong-but-plausible
 * answer: v4-mapped addresses, dual-stack wildcards, interface binds, U rows
 * (the sudo lesson), and a wrong-version line that must refuse loudly.
 */

import { describe, expect, it } from "vitest";
import {
  addressBind,
  decodeNetworkAddress,
  parseOsfactsOutput,
  partitionSubtrees,
  PortScanError,
  type ProcessRow,
  unreadablePolicy,
} from "./scan.ts";

// ── Fixtures ───────────────────────────────────────────────────────────

/** `::ffff:127.0.0.1` and `::ffff:0.0.0.0` in NETWORK order. */
const V4_MAPPED_LOOPBACK = "00000000000000000000ffff7f000001";
const V4_MAPPED_WILDCARD = "00000000000000000000ffff00000000";

/** osfacts TSV carrying the same real observations the retired helper fixtures
 *  did (macOS 26.4 / 27.0). Addresses are NETWORK-order hex. */
const OSFACTS_OUTPUT = [
  "V\t1",
  "P\t1\t0\tlaunchd",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  "P\t4243\t4242\tCore Audio Driver (ParrotAudioPlugin.driver)",
  "P\t757\t1\tControlCenter",
  "P\t27688\t4200\t.emanote-wrapped",
  "P\t53082\t4200\tnode",
  "L\t757\t7000\t00000000",
  "L\t757\t7000\t00000000",
  "L\t27688\t5566\t7f000001",
  "L\t27688\t8079\t00000000",
  "L\t53082\t5173\t00000000000000000000000000000001",
  "L\t53082\t8080\t00000000000000000000000000000000",
  `L\t53082\t8081\t${V4_MAPPED_LOOPBACK}`,
  `L\t53082\t8082\t${V4_MAPPED_WILDCARD}`,
  // 192.168.1.5 in NETWORK order
  "L\t53082\t8078\tc0a80105",
  "",
].join("\n");

const OSFACTS_WITH_U = [
  "V\t1",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  // sudo child — unreadable, still in the subtree
  "U\t991\tEACCES",
  "L\t4242\t5173\t7f000001",
  "",
].join("\n");

// ── Address decoding ───────────────────────────────────────────────────

describe("decodeNetworkAddress", () => {
  it("reads network-order v4", () => {
    expect(decodeNetworkAddress("7f000001")).toEqual([127, 0, 0, 1]);
  });

  it("reads network-order v6", () => {
    expect(decodeNetworkAddress(V4_MAPPED_LOOPBACK)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
    ]);
  });

  it("refuses an address that is not EXACTLY 8 or 32 hex digits", () => {
    expect(() => decodeNetworkAddress("00FF")).toThrow(PortScanError);
    expect(() => decodeNetworkAddress("zzzzzzzz")).toThrow(PortScanError);
    expect(() => decodeNetworkAddress("")).toThrow(PortScanError);
    expect(() => decodeNetworkAddress("0".repeat(16))).toThrow(PortScanError);
  });
});

describe("addressBind", () => {
  it("classifies any / loopback / interface for v4", () => {
    expect(addressBind([0, 0, 0, 0])).toEqual({
      scope: "any",
      family: "v4",
    });
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

// ── osfacts TSV parsing ────────────────────────────────────────────────

describe("parseOsfactsOutput", () => {
  it("reads the two tables and judges each bind through addressBind", () => {
    const { table, listeners, unreadable } = parseOsfactsOutput(OSFACTS_OUTPUT);
    expect(unreadable).toEqual([]);
    expect(table).toEqual([
      { pid: 1, ppid: 0, name: "launchd" },
      { pid: 4200, ppid: 1, name: "zsh" },
      { pid: 4242, ppid: 4200, name: "node" },
      {
        pid: 4243,
        ppid: 4242,
        name: "Core Audio Driver (ParrotAudioPlugin.driver)",
      },
      { pid: 757, ppid: 1, name: "ControlCenter" },
      { pid: 27688, ppid: 4200, name: ".emanote-wrapped" },
      { pid: 53082, ppid: 4200, name: "node" },
    ]);
    expect(listeners).toEqual([
      { port: 7000, scope: "any", family: "v4", pid: 757 },
      { port: 7000, scope: "any", family: "v4", pid: 757 },
      { port: 5566, scope: "loopback", family: "v4", pid: 27688 },
      { port: 8079, scope: "any", family: "v4", pid: 27688 },
      { port: 5173, scope: "loopback", family: "v6", pid: 53082 },
      { port: 8080, scope: "any", family: "v6", pid: 53082 },
      { port: 8081, scope: "loopback", family: "v4", pid: 53082 },
      { port: 8082, scope: "any", family: "v4", pid: 53082 },
      { port: 8078, scope: "interface", family: "v4", pid: 53082 },
    ]);
  });

  it("carries U rows with errno", () => {
    const { unreadable, listeners } = parseOsfactsOutput(OSFACTS_WITH_U);
    expect(unreadable).toEqual([{ pid: 991, errno: "EACCES" }]);
    expect(listeners).toEqual([
      { port: 5173, scope: "loopback", family: "v4", pid: 4242 },
    ]);
  });

  it("refuses output whose version is not the one this reader speaks", () => {
    expect(() => parseOsfactsOutput("V\t2\nP\t1\t0\tlaunchd\n")).toThrow(
      PortScanError,
    );
    expect(() => parseOsfactsOutput("P\t1\t0\tlaunchd\n")).toThrow(
      PortScanError,
    );
    expect(() => parseOsfactsOutput("")).toThrow(PortScanError);
  });

  it("fails loudly on every row it cannot read, rather than skipping it", () => {
    const bad = [
      "V\t1\nP\t1\t0\n",
      "V\t1\nP\tnotapid\t0\tlaunchd\n",
      "V\t1\nL\t1\t0\t00000000\n",
      "V\t1\nL\t1\t70000\t00000000\n",
      "V\t1\nL\t1\t8080\tzz000000\n",
      "V\t1\nL\t1\t8080\t0000\n",
      "V\t1\nU\tnotapid\tEACCES\n",
      "V\t1\nU\t1\n",
      "V\t1\nX\t1\t2\t3\n",
    ];
    for (const body of bad) {
      expect(() => parseOsfactsOutput(body)).toThrow(PortScanError);
    }
  });
});

// ── U-row blindness policy (the sudo lesson) ───────────────────────────

describe("unreadablePolicy", () => {
  it("skips a foreign-uid DESCENDANT rather than blinding the whole host", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 991, errno: "EACCES" }],
      new Set([4200]),
    );
    expect(fatal).toBeNull();
    expect([...skipPids]).toEqual([991]);
  });

  it("is fatal when a requested root is EACCES/EPERM", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 4200, errno: "EPERM" }],
      new Set([4200]),
    );
    expect(fatal).toEqual({ pid: 4200, errno: "EPERM" });
    expect(skipPids.size).toBe(0);
  });

  it("treats a vanished requested root as skip (empty ports), not blind", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 9999, errno: "ENOENT" }],
      new Set([9999]),
    );
    expect(fatal).toBeNull();
    expect([...skipPids]).toEqual([9999]);
  });

  it("skips U rows outside the ask rather than making them fatal", () => {
    const { fatal, skipPids } = unreadablePolicy(
      [{ pid: 1, errno: "EPERM" }],
      new Set([4200]),
    );
    expect(fatal).toBeNull();
    expect([...skipPids]).toEqual([1]);
  });
});

// ── The subtree walk ───────────────────────────────────────────────────

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

  it("walks a repeated root pid once", () => {
    const subtrees = partitionSubtrees(table, [100, 100]);
    expect(subtrees.size).toBe(1);
    expect([...subtrees.get(100)!].sort()).toEqual([100, 200, 300]);
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
