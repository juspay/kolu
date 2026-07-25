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

/** `netstat -anv -p tcp` **captured verbatim from macOS 26.4** (sincereintent,
 *  2026-07-24), trimmed to the interesting rows. Two things here were guesses in
 *  an earlier cut of this file, and both were wrong:
 *
 *   - the owner column is headed **`process:pid`**, not `pid`, and its value is
 *     `node:53082` — a parser looking for a bare `pid` header token threw on every
 *     real scan;
 *   - `tcp46` rows are not hypothetical (two of them on an ordinary desktop).
 *
 *  Kept as REAL output rather than a tidied-up approximation, because every field
 *  this parser gets right it gets right against this exact shape. */
const NETSTAT_TCP = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address                                 Foreign Address                               (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options           gencnt    flags   flags1 usecnt rtncnt fltrs
tcp4       0    168  100.71.48.2.22         100.78.88.70.33556     ESTABLISHED         8452         4310  131072  131396     sshd-session:4976   00182 0000000c 000000001b0838b0 00000080 01000800      2      0 000000
tcp4       0      0  127.0.0.1.51836        *.*                    LISTEN                 0            0  131072  131072             node:53082  00100 00000106 000000001afbe209 00000001 00000800      1      0 000000
tcp46      0      0  *.3283                 *.*                    LISTEN                 0            0  131072  131072         ARDAgent:1039   00000 00000202 0000000000001319 00000040 00000800      2      0 000000
tcp6       0      0  *.49615                *.*                    LISTEN                 0            0  131072  131072 io.tailscale.ipn:1232   00180 00000006 0000000000001ed8 00000000 00000800      1      0 000000
tcp6       0      0  *.88                   *.*                    LISTEN                 0            0  131072  131072              kdc:910    00180 00000006 0000000000000da5 00000001 00000800      1      0 000000
`;

/** A netstat that prints a BARE numeric `pid` column instead of `process:pid` —
 *  the older spelling, read by the same parser off what the header says. Also a
 *  different column count before it, which is what a version bump changes: a parser
 *  that hardcoded the pid's position would read `131072` as a pid here and
 *  attribute every port to nobody, silently. */
const NETSTAT_TCP_BARE_PID = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)    rhiwat shiwat pid   epid
tcp4       0      0  *.8080                 *.*                    LISTEN     131072 131072  4242     0
`;

/** A LISTEN row whose owner NAME contains a space — the case that shifts every
 *  field after it, and the reason the `name:pid` owner is found by searching for
 *  the colon-bearing token rather than by counting columns. */
const NETSTAT_TCP_SPACED_OWNER = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)    rxbytes txbytes rhiwat shiwat          process:pid    state
tcp4       0      0  *.7777                 *.*                    LISTEN     0       0      131072 131072   Software Update:4321   00100
`;

/** `ps -axo pid,ppid,comm` from the same macOS 26.4 box. The last two rows are
 *  real: `comm` is a full PATH that really does contain spaces, which is why the
 *  name is the line's untouched remainder and only then a basename. */
const PS_TABLE = `  PID  PPID COMM
    1     0 /sbin/launchd
  581     1 /usr/libexec/logd
 4200     1 /bin/zsh
 4242  4200 /Users/srid/.nix-profile/bin/node
 4243  4242 /System/Library/CoreServices/Software Update.app/Contents/Resources/softwareupdated
 4244  4242 Core Audio Driver (ParrotAudioPlugin.driver)
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
      { pid: 581, ppid: 1, name: "logd" },
      { pid: 4200, ppid: 1, name: "zsh" },
      { pid: 4242, ppid: 4200, name: "node" },
      // A real path with a space in it — the basename is past the space.
      { pid: 4243, ppid: 4242, name: "softwareupdated" },
      // And a real `comm` that is not a path at all, so the whole remainder is
      // the name (spaces and parentheses included).
      {
        pid: 4244,
        ppid: 4242,
        name: "Core Audio Driver (ParrotAudioPlugin.driver)",
      },
    ]);
  });

  it("fails loudly on a table with no header", () => {
    expect(() => parsePsTable("4242 4200 node\n")).toThrow(PortScanError);
  });
});

describe("parseNetstatTcp", () => {
  it("reads REAL macOS 26.4 output: LISTEN rows across tcp4/tcp6/tcp46, owner `process:pid`", () => {
    expect(parseNetstatTcp(NETSTAT_TCP)).toEqual([
      // A loopback-bound node dev server — the case that needs a forward.
      { port: 51836, wildcard: false, pid: 53082 },
      // tcp46 is a dual-stack socket, not an unknown protocol to skip.
      { port: 3283, wildcard: true, pid: 1039 },
      // A name with dots in it (`io.tailscale.ipn:1232`) — the pid is after the
      // LAST colon, not the first.
      { port: 49615, wildcard: true, pid: 1232 },
      { port: 88, wildcard: true, pid: 910 },
    ]);
    // …and the ESTABLISHED ssh connection this session arrived over is not a
    // listener, so it contributes nothing.
    expect(parseNetstatTcp(NETSTAT_TCP)).toHaveLength(4);
  });

  it("reads a BARE numeric pid column too, off what the header says", () => {
    expect(parseNetstatTcp(NETSTAT_TCP_BARE_PID)).toEqual([
      { port: 8080, wildcard: true, pid: 4242 },
    ]);
  });

  it("finds the owner pid even when the process NAME contains a space", () => {
    // A space shifts every field after it, so the owner cannot be found by
    // counting columns.
    expect(parseNetstatTcp(NETSTAT_TCP_SPACED_OWNER)).toEqual([
      { port: 7777, wildcard: true, pid: 4321 },
    ]);
  });

  it("reads a v6 loopback as a specific address, not a wildcard", () => {
    const v6Loopback = `Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)    process:pid
tcp6       0      0  ::1.5001               *.*                    LISTEN     node:4243
tcp6       0      0  fe80::1%lo0.5002       *.*                    LISTEN     node:4244
`;
    // The port is after the FINAL dot, and a colon-rich host is not a wildcard
    // however many colons it has.
    expect(parseNetstatTcp(v6Loopback)).toEqual([
      { port: 5001, wildcard: false, pid: 4243 },
      { port: 5002, wildcard: false, pid: 4244 },
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
