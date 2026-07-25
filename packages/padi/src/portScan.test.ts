/**
 * The port scan's PARSERS, against real-shaped fixtures — the half of the scanner
 * that can be pinned without an OS.
 *
 * Every fixture here reproduces a subtlety the 2026-07-24 spike surfaced on real
 * hosts, because each one is a way the naive parse produces a plausible WRONG
 * answer rather than an error:
 *  - `/proc/net/tcp` addresses are byte-reversed hex, and IPv6 is reversed
 *    PER 32-BIT WORD (not across the whole string);
 *  - a v4-mapped IPv6 wildcard (`::ffff:0.0.0.0`) is a wildcard, and a v4-mapped
 *    loopback is not — they differ in the last four bytes only;
 *  - a dual-stack server appears twice (`tcp`+`tcp6`, or `tcp46`) for one port;
 *  - a fork-inherited socket maps one inode to several pids;
 *  - `/proc/<pid>/stat`'s `comm` can contain spaces AND parentheses;
 *  - macOS `netstat` verbose columns are not a fixed layout, so `pid` must be
 *    located by NAME.
 */

import { describe, expect, it } from "vitest";
import {
  decodeProcAddress,
  foldPorts,
  isAnyAddress,
  parseNetstatTcp,
  parseProcNetTcp,
  parseProcStat,
  parsePsTable,
  partitionSubtrees,
  PortScanError,
  type ProcessRow,
} from "./portScan.ts";

// ── Fixtures ───────────────────────────────────────────────────────────

/** `/proc/net/tcp` as a 6.x kernel prints it. Ports: 0x1F90 = 8080 (wildcard),
 *  0x1389 = 5001 (loopback). The third row is an ESTABLISHED connection to that
 *  loopback listener — `st` 01, not 0A — which must NOT become a chip. */
const PROC_NET_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1 0000000000000000 100 0 0 10 0
   1: 0100007F:1389 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4243 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1389 0100007F:C001 01 00000000:00000000 00:00000000 00000000  1000        0 4244 1 0000000000000000 20 4 30 10 -1
`;

/** `/proc/net/tcp6`. Row 0 is `::` (wildcard, 0x1451 = 5201); row 1 is the
 *  v4-MAPPED LOOPBACK `::ffff:127.0.0.1` (0x1F91 = 8081) — a specific address that
 *  a naive "16 bytes, therefore v6" reading would mangle; row 2 is the v4-MAPPED
 *  WILDCARD `::ffff:0.0.0.0` (0x1F92 = 8082), which differs from row 1 in its last
 *  four bytes alone and IS reachable. */
const PROC_NET_TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1451 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5555 1 0000000000000000 100 0 0 10 0
   1: 0000000000000000FFFF00000100007F:1F91 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5556 1 0000000000000000 100 0 0 10 0
   2: 0000000000000000FFFF000000000000:1F92 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5557 1 0000000000000000 100 0 0 10 0
`;

/** macOS `netstat -anv -p tcp`, the layout the spike measured. */
const NETSTAT_TCP = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)     rxbytes txbytes rhiwat shiwat pid   epid state    options
tcp4       0      0  *.8080                 *.*                    LISTEN      0       0      131072 131072  4242     0 0x0000   0x0000
tcp6       0      0  ::1.5001               *.*                    LISTEN      0       0      131072 131072  4243     0 0x0000   0x0000
tcp46      0      0  *.3000                 *.*                    LISTEN      0       0      131072 131072  4244     0 0x0000   0x0000
tcp4       0      0  127.0.0.1.5432         *.*                    LISTEN      0       0      131072 131072  4245     0 0x0000   0x0000
tcp4       0      0  192.168.1.5.61234      93.184.216.34.443      ESTABLISHED 0       0      131072 131072  4246     0 0x0000   0x0000
`;

/** The SAME facts under a different verbose column set — fewer columns before
 *  `pid`, which is exactly what a macOS version bump changes. A parser that
 *  hardcoded the pid's position would read `131072` as a pid here and attribute
 *  every port to nobody, silently. */
const NETSTAT_TCP_OTHER_COLUMNS = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)    rhiwat shiwat pid   epid
tcp4       0      0  *.8080                 *.*                    LISTEN     131072 131072  4242     0
`;

const PS_TABLE = `  PID  PPID COMM
    1     0 /sbin/launchd
 4200  1    /bin/zsh
 4242  4200 /nix/store/abc123-nodejs-22.14.0/bin/node
 4243  4242 /Applications/Some App.app/Contents/MacOS/helper tool
`;

// ── Address decoding ───────────────────────────────────────────────────

describe("decodeProcAddress", () => {
  it("un-reverses a v4 address", () => {
    // 0100007F is 127.0.0.1 — the single most common listener on any dev box, and
    // the one a byte-order mistake turns into 1.0.0.127.
    expect(decodeProcAddress("0100007F")).toEqual([127, 0, 0, 1]);
  });

  it("reverses IPv6 PER WORD, not across the whole address", () => {
    // ::ffff:127.0.0.1. Reversing the whole 16 bytes would put the 7F at the
    // front and the ffff in the middle — a different, valid-looking address.
    expect(decodeProcAddress("0000000000000000FFFF00000100007F")).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
    ]);
  });

  it("refuses an address that is not 8 or 32 hex digits", () => {
    expect(() => decodeProcAddress("00FF")).toThrow(PortScanError);
    expect(() => decodeProcAddress("zzzzzzzz")).toThrow(PortScanError);
  });
});

describe("isAnyAddress", () => {
  it("accepts 0.0.0.0 and ::", () => {
    expect(isAnyAddress([0, 0, 0, 0])).toBe(true);
    expect(isAnyAddress(new Array(16).fill(0))).toBe(true);
  });

  it("accepts the v4-mapped wildcard and rejects the v4-mapped loopback", () => {
    // The pair that differs in four bytes and means opposite things.
    const mapped = (v4: number[]) => [
      ...new Array(10).fill(0),
      0xff,
      0xff,
      ...v4,
    ];
    expect(isAnyAddress(mapped([0, 0, 0, 0]))).toBe(true);
    expect(isAnyAddress(mapped([127, 0, 0, 1]))).toBe(false);
  });

  it("rejects a specific address", () => {
    expect(isAnyAddress([127, 0, 0, 1])).toBe(false);
    expect(isAnyAddress([192, 168, 1, 5])).toBe(false);
  });
});

// ── /proc parsing ──────────────────────────────────────────────────────

describe("parseProcNetTcp", () => {
  it("takes LISTEN rows only, with their port and bind kind", () => {
    expect(parseProcNetTcp(PROC_NET_TCP)).toEqual([
      { port: 8080, wildcard: true, inode: "4242" },
      { port: 5001, wildcard: false, inode: "4243" },
    ]);
  });

  it("reads a v4-mapped wildcard as reachable and a v4-mapped loopback as not", () => {
    expect(parseProcNetTcp(PROC_NET_TCP6)).toEqual([
      { port: 5201, wildcard: true, inode: "5555" },
      { port: 8081, wildcard: false, inode: "5556" },
      { port: 8082, wildcard: true, inode: "5557" },
    ]);
  });

  it("fails loudly on a body with no header", () => {
    // A silently-empty parse is the failure mode this guards: it would render as
    // "this terminal serves nothing", which is indistinguishable from the truth.
    expect(() => parseProcNetTcp("garbage\n")).toThrow(PortScanError);
  });

  it("fails loudly on a truncated row rather than dropping it", () => {
    const truncated = `  sl  local_address rem_address   st tx_queue
   0: 00000000:1F90 00000000:0000 0A
`;
    expect(() => parseProcNetTcp(truncated)).toThrow(PortScanError);
  });
});

describe("parseProcStat", () => {
  it("reads pid, comm and ppid", () => {
    expect(
      parseProcStat("4242 (node) S 4200 4200 4200 0 -1 4194560 1234"),
    ).toEqual({ pid: 4242, name: "node", ppid: 4200 });
  });

  it("survives a comm containing spaces and parentheses", () => {
    // The reason the fields after comm are read from the LAST `)`. A
    // `split(/\s+/)` here would read "prog" as the state and "(2))" as the ppid.
    expect(parseProcStat("77 (my prog (2)) S 1 1 1 0 -1 4194560 99")).toEqual({
      pid: 77,
      name: "my prog (2)",
      ppid: 1,
    });
  });

  it("fails loudly on a body with no parenthesized comm", () => {
    expect(() => parseProcStat("4242 node S 4200")).toThrow(PortScanError);
  });
});

// ── darwin parsing ─────────────────────────────────────────────────────

describe("parsePsTable", () => {
  it("reads pid/ppid and reduces comm to a basename", () => {
    expect(parsePsTable(PS_TABLE)).toEqual([
      { pid: 1, ppid: 0, name: "launchd" },
      { pid: 4200, ppid: 1, name: "zsh" },
      { pid: 4242, ppid: 4200, name: "node" },
      // macOS `comm` is a full path that may contain spaces — it is the row's
      // untouched remainder, so the basename keeps the space.
      { pid: 4243, ppid: 4242, name: "helper tool" },
    ]);
  });

  it("fails loudly on a table with no header", () => {
    expect(() => parsePsTable("4242 4200 node\n")).toThrow(PortScanError);
  });
});

describe("parseNetstatTcp", () => {
  it("takes LISTEN rows across tcp4/tcp6/tcp46 with their pid", () => {
    expect(parseNetstatTcp(NETSTAT_TCP)).toEqual([
      { port: 8080, wildcard: true, pid: 4242 },
      // `::1.5001` — the port is after the FINAL dot, and a v6 loopback is not a
      // wildcard however many colons it has.
      { port: 5001, wildcard: false, pid: 4243 },
      // tcp46 is a dual-stack socket, not an unknown protocol to skip.
      { port: 3000, wildcard: true, pid: 4244 },
      { port: 5432, wildcard: false, pid: 4245 },
    ]);
  });

  it("locates the pid column by NAME, so a different verbose layout still reads", () => {
    expect(parseNetstatTcp(NETSTAT_TCP_OTHER_COLUMNS)).toEqual([
      { port: 8080, wildcard: true, pid: 4242 },
    ]);
  });

  it("fails loudly when the pid column is absent (a netstat run without -v)", () => {
    const noVerbose = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)
tcp4       0      0  *.8080                 *.*                    LISTEN
`;
    expect(() => parseNetstatTcp(noVerbose)).toThrow(PortScanError);
  });

  it("fails loudly on a non-tcp row rather than misreading its columns", () => {
    const mixed = `Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)    pid
udp4       0      0  *.5353                 *.*                               4242
`;
    expect(() => parseNetstatTcp(mixed)).toThrow(PortScanError);
  });
});

// ── The per-terminal fold ──────────────────────────────────────────────

describe("foldPorts", () => {
  it("collapses a fork-inherited socket seen on several pids", () => {
    // One listener, three processes holding the same fd. Without the collapse the
    // Inspector shows the same port three times.
    expect(
      foldPorts([
        { port: 3000, wildcard: true, name: "node" },
        { port: 3000, wildcard: true, name: "node" },
        { port: 3000, wildcard: true, name: "node" },
      ]),
    ).toEqual([{ port: 3000, name: "node", wildcard: true }]);
  });

  it("treats a port reachable on ANY of its binds as reachable", () => {
    // A server bound to both 127.0.0.1 and 0.0.0.0 contributes two rows for one
    // port. It IS reachable, so offering a forward for it would be wrong — and
    // picking whichever row came first would make the answer depend on fd order.
    expect(
      foldPorts([
        { port: 5173, wildcard: false, name: "node" },
        { port: 5173, wildcard: true, name: "node" },
      ]),
    ).toEqual([{ port: 5173, name: "node", wildcard: true }]);
  });

  it("keeps a port whose every bind is loopback as needing a forward", () => {
    expect(
      foldPorts([
        { port: 5432, wildcard: false, name: "postgres" },
        { port: 5432, wildcard: false, name: "postgres" },
      ]),
    ).toEqual([{ port: 5432, name: "postgres", wildcard: false }]);
  });

  it("sorts by port, so an unchanged host produces an identical sample", () => {
    // Load-bearing for the churn guard: `portsEqual` is order-sensitive, so an
    // unsorted fold would emit a "change" on fd-iteration order alone, forever.
    expect(
      foldPorts([
        { port: 9229, wildcard: true, name: "node" },
        { port: 3000, wildcard: true, name: "node" },
        { port: 61922, wildcard: true, name: "workerd" },
      ]).map((p) => p.port),
    ).toEqual([3000, 9229, 61922]);
  });
});

// ── The subtree walk ───────────────────────────────────────────────────

describe("partitionSubtrees", () => {
  /** shell 100 → node 200 → worker 300; a sibling shell 400 with its own child. */
  const table: ProcessRow[] = [
    { pid: 1, ppid: 0, name: "init" },
    { pid: 100, ppid: 1, name: "bash" },
    { pid: 200, ppid: 100, name: "node" },
    { pid: 300, ppid: 200, name: "workerd" },
    { pid: 400, ppid: 1, name: "zsh" },
    { pid: 500, ppid: 400, name: "vite" },
  ];

  it("walks grandchildren, and keeps sibling terminals apart", () => {
    const subtrees = partitionSubtrees(table, [
      { id: "A", rootPid: 100 },
      { id: "B", rootPid: 400 },
    ]);
    expect([...subtrees.get("A")!].sort()).toEqual([100, 200, 300]);
    expect([...subtrees.get("B")!].sort()).toEqual([400, 500]);
  });

  it("gives a dead root an empty subtree rather than omitting the terminal", () => {
    // Every requested id must be present, so the caller can publish the whole set
    // without asking which ids were covered — an exiting terminal's ports leave.
    const subtrees = partitionSubtrees(table, [{ id: "gone", rootPid: 9999 }]);
    expect(subtrees.has("gone")).toBe(true);
    expect(subtrees.get("gone")!.size).toBe(0);
  });

  it("terminates on a cyclic ppid chain instead of overflowing the stack", () => {
    // A racy /proc read can present a pid as its own ancestor. The walk must
    // report ports, not blow up.
    const cyclic: ProcessRow[] = [
      { pid: 10, ppid: 11, name: "a" },
      { pid: 11, ppid: 10, name: "b" },
    ];
    const subtrees = partitionSubtrees(cyclic, [{ id: "C", rootPid: 10 }]);
    expect([...subtrees.get("C")!].sort()).toEqual([10, 11]);
  });
});
