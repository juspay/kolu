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
 *  - macOS `lsof` field output is tagged per line, so a process name with a
 *    space in it cannot shift a column.
 */

import { describe, expect, it } from "vitest";
import {
  decodeNetworkAddress,
  decodeProcAddress,
  procReadFailure,
  isAnyAddress,
  parseHelperOutput,
  parseProcNetTcp,
  parseProcStat,
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

/** `::ffff:127.0.0.1` and `::ffff:0.0.0.0` in NETWORK order. They differ in their
 *  last four bytes alone and mean opposite things: the first needs a forward, the
 *  second already answers. */
const V4_MAPPED_LOOPBACK = "00000000000000000000ffff7f000001";
const V4_MAPPED_WILDCARD = "00000000000000000000ffff00000000";

/** The libproc helper's stdout, carrying the SAME real observations the retired
 *  `ps`+`lsof` fixtures did (macOS 26.4 sincereintent and 27.0 zest): the
 *  `ControlCenter` dual-fd wildcard, one process holding a loopback AND a wildcard
 *  port at once, and a Node server on v6. Addresses are NETWORK-order hex, which is
 *  what the helper prints. */
const HELPER_OUTPUT = [
  "V\t1",
  "P\t1\t0\tlaunchd",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  // A real name with spaces and parentheses — the reason `<name>` is the last field.
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
  "",
].join("\n");

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

  it("refuses an address that is not EXACTLY 8 or 32 hex digits", () => {
    expect(() => decodeProcAddress("00FF")).toThrow(PortScanError);
    expect(() => decodeProcAddress("zzzzzzzz")).toThrow(PortScanError);
    expect(() => decodeProcAddress("")).toThrow(PortScanError);
    // The widths a `% 8` check let through. A changed or corrupt row would have
    // sailed past this loud parser and been classified as a SPECIFIC bind — the
    // safe-looking answer — instead of faulting the pass.
    expect(() => decodeProcAddress("0".repeat(16))).toThrow(PortScanError);
    expect(() => decodeProcAddress("0".repeat(24))).toThrow(PortScanError);
    expect(() => decodeProcAddress("0".repeat(40))).toThrow(PortScanError);
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

describe("parseHelperOutput", () => {
  it("reads the helper's two tables, and judges wildcardness through isAnyAddress", () => {
    const { table, listeners } = parseHelperOutput(HELPER_OUTPUT);
    // Names come through verbatim — the helper already took the basename, and one
    // of these really does contain spaces on a live Mac.
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
      // Two fds on one wildcard port — a dual-stack listener, folded later.
      { port: 7000, wildcard: true, pid: 757 },
      { port: 7000, wildcard: true, pid: 757 },
      // The case from the field report: a loopback dev server (needs a forward)
      // beside a wildcard one (does not), in the SAME process.
      { port: 5566, wildcard: false, pid: 27688 },
      { port: 8079, wildcard: true, pid: 27688 },
      // IPv6: `::1` is specific, `::` is the wildcard.
      { port: 5173, wildcard: false, pid: 53082 },
      { port: 8080, wildcard: true, pid: 53082 },
      // The subtle pair, four bytes apart and opposite in meaning: the v4-mapped
      // LOOPBACK needs a forward, the v4-mapped WILDCARD does not.
      { port: 8081, wildcard: false, pid: 53082 },
      { port: 8082, wildcard: true, pid: 53082 },
    ]);
  });

  it("refuses output whose version is not the one this padi reads", () => {
    // The helper is baked by Nix alongside padi, so a version mismatch means the
    // two came from different builds. Failing loudly is the whole point: a shape
    // this parser half-understands would yield zero listeners, which renders
    // identically to "no terminal is serving anything".
    expect(() => parseHelperOutput("V\t2\nP\t1\t0\tlaunchd\n")).toThrow(
      PortScanError,
    );
    expect(() => parseHelperOutput("P\t1\t0\tlaunchd\n")).toThrow(
      PortScanError,
    );
    expect(() => parseHelperOutput("")).toThrow(PortScanError);
  });

  it("fails loudly on every row it cannot read, rather than skipping it", () => {
    const bad = [
      "V\t1\nP\t1\t0\n", // too few fields
      "V\t1\nP\tnotapid\t0\tlaunchd\n", // non-numeric pid
      "V\t1\nL\t1\t0\t00000000\n", // port 0 is not a listener
      "V\t1\nL\t1\t70000\t00000000\n", // out of range
      "V\t1\nL\t1\t8080\tzz000000\n", // not hex
      "V\t1\nL\t1\t8080\t0000\n", // neither 8 nor 32 digits
      "V\t1\nX\t1\t2\t3\n", // a tag from a future format
    ];
    for (const body of bad) {
      expect(() => parseHelperOutput(body)).toThrow(PortScanError);
    }
  });

  it("does NOT run the helper's hex through the /proc decoder", () => {
    // The two byte orders are the one difference the types cannot catch. `/proc`
    // prints each 32-bit word host-order, so its decoder byte-swaps; the helper
    // emits network order already. Swapping `7f000001` would give `1.0.0.127` — a
    // specific address either way, so nothing would throw and a loopback bind
    // would just be mis-attributed to some other host.
    expect(decodeNetworkAddress("7f000001")).toEqual([127, 0, 0, 1]);
    expect(decodeProcAddress("7f000001")).toEqual([1, 0, 0, 127]);
    // Which is exactly why the wildcard judge must be reached through the right
    // decoder — and why `::ffff:0.0.0.0` still has to come out reachable.
    expect(isAnyAddress(decodeNetworkAddress(V4_MAPPED_WILDCARD))).toBe(true);
    expect(isAnyAddress(decodeNetworkAddress(V4_MAPPED_LOOPBACK))).toBe(false);
  });
});

// ── Which /proc/<pid>/fd failures are fatal ────────────────────────────

describe("procReadFailure", () => {
  // Reviewed into existence: every in-subtree EACCES used to throw, so ONE
  // `sudo` at a password prompt in ONE terminal emptied the Ports section for
  // EVERY terminal on the host until the prompt was answered. Verified on a live
  // box: a `sudo` child is root-owned with an unreadable `fd/`, and its ppid is a
  // shell — a descendant, not a root.
  it("skips a foreign-uid DESCENDANT rather than blinding the whole host", () => {
    expect(procReadFailure("EACCES", false)).toBe("skip");
    expect(procReadFailure("EPERM", false)).toBe("skip");
  });

  it("THROWS when the unreadable pid is a requested terminal root", () => {
    // padi spawned that shell, so it is padi's own uid; unreadable there means we
    // truly cannot answer for the terminal, and "no ports" would be a lie.
    expect(procReadFailure("EACCES", true)).toBe("throw");
    expect(procReadFailure("EPERM", true)).toBe("throw");
  });

  it("skips the exit race on either kind of pid", () => {
    for (const isRoot of [true, false]) {
      expect(procReadFailure("ENOENT", isRoot)).toBe("skip");
      expect(procReadFailure("ESRCH", isRoot)).toBe("skip");
    }
  });

  it("THROWS on an errno it does not recognize, root or not", () => {
    // An unmodelled failure is not something to swallow on either kind of pid.
    expect(procReadFailure("EIO", false)).toBe("throw");
    expect(procReadFailure(undefined, false)).toBe("throw");
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

  it("walks grandchildren, and keeps sibling subtrees apart", () => {
    const subtrees = partitionSubtrees(table, [100, 400]);
    expect([...subtrees.get(100)!].sort()).toEqual([100, 200, 300]);
    expect([...subtrees.get(400)!].sort()).toEqual([400, 500]);
  });

  it("gives a dead root an empty subtree rather than omitting the key", () => {
    // Every requested pid must be present, so the caller can publish the whole set
    // without asking which were covered — an exiting terminal's ports leave.
    const subtrees = partitionSubtrees(table, [9999]);
    expect(subtrees.has(9999)).toBe(true);
    expect(subtrees.get(9999)!.size).toBe(0);
  });

  it("walks a repeated root pid once", () => {
    // Keying on the pid rather than on a caller's label is what makes this true:
    // two terminals rooted at the same pid ask one question, not two.
    const subtrees = partitionSubtrees(table, [100, 100]);
    expect(subtrees.size).toBe(1);
    expect([...subtrees.get(100)!].sort()).toEqual([100, 200, 300]);
  });

  it("terminates on a cyclic ppid chain instead of overflowing the stack", () => {
    // A racy /proc read can present a pid as its own ancestor. The walk must
    // report ports, not blow up.
    const cyclic: ProcessRow[] = [
      { pid: 10, ppid: 11, name: "a" },
      { pid: 11, ppid: 10, name: "b" },
    ];
    const subtrees = partitionSubtrees(cyclic, [10]);
    expect([...subtrees.get(10)!].sort()).toEqual([10, 11]);
  });
});
