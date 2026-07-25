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
  bindsAny,
  decodeProcAddress,
  procReadFailure,
  isAnyAddress,
  parseBindAddress,
  parseLsofListeners,
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

/** `lsof -nP -w -iTCP -sTCP:LISTEN -Fpcn` **captured verbatim from macOS 27.0**
 *  (zest) and 26.4 (sincereintent), stitched into one body.
 *
 *  lsof replaced `netstat` here because on macOS 27.0 netstat returns an EMPTY
 *  internet table to a padi process while reporting success — see the module
 *  header. This shape is what the scan actually reads now. */
const LSOF_LISTEN = `p757
cControlCenter
f9
n*:7000
f10
n*:7000
p27688
c.emanote-wrapped
f57
n127.0.0.1:5566
f60
n*:8079
p53082
cnode
f18
n[::1]:5173
f21
n[::]:8080
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

describe("parseBindAddress / bindsAny", () => {
  it("reads lsof's `*` as the wildcard it means", () => {
    expect(parseBindAddress("*")).toBe("any");
    expect(bindsAny("*")).toBe(true);
  });

  it("agrees with the /proc path on every wildcard spelling", () => {
    // The finding this replaces: two predicates, one over bytes and one over
    // text, that disagreed about `::ffff:0.0.0.0` — so the SAME server on the
    // SAME port read as reachable on linux and as needing a forward on darwin.
    for (const spelling of ["0.0.0.0", "::", "::ffff:0.0.0.0", "*"]) {
      expect(bindsAny(spelling)).toBe(true);
    }
    for (const spelling of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "192.168.1.5",
      "fe80::1%en0",
    ]) {
      expect(bindsAny(spelling)).toBe(false);
    }
  });

  it("expands `::` elision and a trailing embedded v4 to 16 bytes", () => {
    expect(parseBindAddress("::1")).toEqual([...new Array(15).fill(0), 1]);
    expect(parseBindAddress("::ffff:127.0.0.1")).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
    ]);
    expect(parseBindAddress("fe80::1")).toEqual([
      0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("fails loudly on text that is not an address", () => {
    // A silent "specific address" reading would render as an inert chip claiming
    // a forward is needed, with nothing anywhere to say the parse was wrong.
    expect(() => parseBindAddress("nonsense")).toThrow(PortScanError);
    expect(() => parseBindAddress("1.2.3")).toThrow(PortScanError);
    expect(() => parseBindAddress("300.1.1.1")).toThrow(PortScanError);
    expect(() => parseBindAddress("::1::2")).toThrow(PortScanError);
    expect(() => parseBindAddress("1:2:3")).toThrow(PortScanError);
  });

  it("rejects the legacy non-dotted IPv4 spellings ipaddr.js accepts", () => {
    // `ipaddr.parse` alone reads all three of these as addresses, and `"0"` as
    // `0.0.0.0` — so an address field holding junk would classify as a WILDCARD
    // bind and mint a chip claiming to be openable. That is the one direction this
    // module must never be lax in, and no socket table spells a bind address this
    // way, so the narrowing rejects only shapes that cannot legitimately arrive.
    for (const spelling of ["0", "0x7f000001", "2130706433", "127.1"]) {
      expect(() => parseBindAddress(spelling)).toThrow(PortScanError);
    }
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

describe("parseLsofListeners", () => {
  it("reads REAL macOS lsof field output: pid, port, and how it is bound", () => {
    expect(parseLsofListeners(LSOF_LISTEN)).toEqual([
      // Two fds on one wildcard port — a dual-stack listener, folded later.
      { port: 7000, wildcard: true, pid: 757 },
      { port: 7000, wildcard: true, pid: 757 },
      // The case from the field report: a loopback dev server (needs a forward)
      // beside a wildcard one (does not), in the SAME process.
      { port: 5566, wildcard: false, pid: 27688 },
      { port: 8079, wildcard: true, pid: 27688 },
      // Bracketed IPv6: the port is after the LAST colon, which is what brackets
      // make unambiguous.
      { port: 5173, wildcard: false, pid: 53082 },
      { port: 8080, wildcard: true, pid: 53082 },
    ]);
  });

  it("treats `::` and `0.0.0.0` as reachable, and a specific address as not", () => {
    expect(
      parseLsofListeners(
        "p1\ncx\nf3\nn0.0.0.0:80\nf4\nn[::]:81\nf5\nn10.0.0.2:82\n",
      ),
    ).toEqual([
      { port: 80, wildcard: true, pid: 1 },
      { port: 81, wildcard: true, pid: 1 },
      { port: 82, wildcard: false, pid: 1 },
    ]);
  });

  it("classifies the v4-MAPPED pair exactly as the /proc parser does", () => {
    // Pinned rather than assumed: nothing says lsof never spells a dual-stack
    // `0.0.0.0` bind in its v4-mapped form, and the two platforms reading the
    // same address differently is a chip that offers a forward for a port that
    // already answers (or withholds one from a port that doesn't).
    expect(
      parseLsofListeners(
        "p1\ncx\nf3\nn[::ffff:0.0.0.0]:80\nf4\nn[::ffff:127.0.0.1]:81\n",
      ),
    ).toEqual([
      { port: 80, wildcard: true, pid: 1 },
      { port: 81, wildcard: false, pid: 1 },
    ]);
  });

  it("is empty for an empty body — lsof's honest 'nothing is listening'", () => {
    expect(parseLsofListeners("")).toEqual([]);
  });

  it("fails loudly on an address with no port", () => {
    expect(() => parseLsofListeners("p1\ncx\nf3\nnnonsense\n")).toThrow(
      PortScanError,
    );
  });

  it("fails loudly on an address that arrives before any process", () => {
    // Field output is positional by construction; an `n` with no `p` above it
    // means we are not reading what we think we are.
    expect(() => parseLsofListeners("f3\nn*:80\n")).toThrow(PortScanError);
  });
});

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
