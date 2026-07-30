/**
 * Contract pins for the client — fixtures only, no OS. Spawn round-trips
 * against a real binary live in the consumer (padi) live suite.
 */

import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OsfactsClientError,
  parseHostOutput,
  parseSnapshotOutput,
  parseSocketHoldersOutput,
  OSFACTS_FORMAT_VERSION,
  snapshotHost,
  snapshotPidsSync,
  socketHolders,
} from "./client.ts";

const V4_MAPPED_LOOPBACK = "00000000000000000000ffff7f000001";

const SNAPSHOT_SAMPLE = [
  "V\t2",
  "P\t1\t0\tlaunchd",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  "M\t4242\t12345678",
  "S\t4242\t1710000000123456",
  "C\t4242\t987654",
  "UID\t4242\t1000",
  'CWD\t4242\t"/tmp/a\\tb\\nc"',
  "STAT\t4242\tR\t-5\t12",
  'ARGV\t4242\t["node","a\\tb","c\\nd","e\\u0000f"]',
  "L\tclaimed\t4242\t1000\t5173\t7f000001",
  `L\tunclaimed\t-\t0\t8081\t${V4_MAPPED_LOOPBACK}`,
  "U\t991\tports\tEACCES",
  "E\tdarwin_tcp_pcblist\tports_unclaimed\tBLIND_OR_EMPTY",
  "",
].join("\n");

const HOLDERS_SAMPLE = [
  "V\t2",
  "H\tclaimed\t4242",
  "H\tunclaimed\t-",
  "P\t4242\t4200\tkaval",
  "U\t4243\tproc\tESRCH",
  "E\tdarwin_proc_fds\tsocket_holders\tBLIND_OR_EMPTY",
  "",
].join("\n");

const HOST_SAMPLE = [
  "V\t2",
  "HLOAD\t0.5\t1\t1.5",
  "HMEM\t16000\t8000",
  "HSWAP\t2000\t100",
  "HUP\t123456",
  'HCPU\t0\t10\t20\t30\t40\t"Apple M1 Max"\t-',
  "HNET\ten0\t100\t200",
  "HDISK\t/\t1000\t700\t800",
  "E\tsysinfo_networks\tnet\tBLIND_OR_EMPTY",
  "",
].join("\n");

describe("parseSnapshotOutput", () => {
  it("reads the v2 P/M/S/C/UID/CWD/STAT/ARGV/L/U/E contract", () => {
    const r = parseSnapshotOutput(SNAPSHOT_SAMPLE);
    expect(r.procs).toEqual([
      { pid: 1, ppid: 0, name: "launchd" },
      { pid: 4200, ppid: 1, name: "zsh" },
      { pid: 4242, ppid: 4200, name: "node" },
    ]);
    expect(r.memory).toEqual([{ pid: 4242, rssBytes: 12345678 }]);
    expect(r.startTimes).toEqual([
      { pid: 4242, startUnixUs: 1710000000123456 },
    ]);
    expect(r.cpuTimes).toEqual([{ pid: 4242, cpuTimeUs: 987654 }]);
    expect(r.uids).toEqual([{ pid: 4242, uid: 1000 }]);
    expect(r.cwds).toEqual([{ pid: 4242, cwd: "/tmp/a\tb\nc" }]);
    expect(r.statuses).toEqual([
      { pid: 4242, state: "R", nice: -5, threads: 12 },
    ]);
    expect(r.argv).toEqual([
      { pid: 4242, argv: ["node", "a\tb", "c\nd", "e\0f"] },
    ]);
    expect(r.ports).toEqual([
      {
        status: "claimed",
        pid: 4242,
        uid: 1000,
        port: 5173,
        address: "7f000001",
      },
      {
        status: "unclaimed",
        uid: 0,
        port: 8081,
        address: V4_MAPPED_LOOPBACK,
      },
    ]);
    expect(r.unreadable).toEqual([
      { pid: 991, facet: "ports", errno: "EACCES" },
    ]);
    expect(r.errors).toEqual([
      {
        source: "darwin_tcp_pcblist",
        facet: "ports_unclaimed",
        code: "BLIND_OR_EMPTY",
      },
    ]);
  });

  it("offers a host-wide process snapshot without a fake pid scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-fixture");
    try {
      await writeFile(
        bin,
        '#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = snapshot ] && [ "$2" = --uid ] || exit 9\nprintf "V\\t2\\nUID\\t1\\t0\\n"\n',
      );
      await chmod(bin, 0o755);
      await expect(snapshotHost(bin, { uid: true })).resolves.toMatchObject({
        uids: [{ pid: 1, uid: 0 }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the E rows of a totally-blind probe that exited non-zero", async () => {
    // The binary's documented total-failure path is "write the V line and its
    // E rows, then exit 1". That document is the only place the answer to
    // *which source went blind* exists; discarding it for the exit status left
    // every consumer an opaque "non-zero exit".
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-blind");
    try {
      await writeFile(
        bin,
        '#!/bin/sh\nprintf "V\\t2\\nE\\tproc_readdir\\tproc\\tEACCES\\n"\nexit 1\n',
      );
      await chmod(bin, 0o755);
      await expect(snapshotHost(bin, { procs: true })).resolves.toMatchObject({
        procs: [],
        errors: [{ source: "proc_readdir", facet: "proc", code: "EACCES" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still fails loudly when a non-zero exit produced no document", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-broken");
    try {
      await writeFile(bin, '#!/bin/sh\necho "boom" >&2\nexit 3\n');
      await chmod(bin, 0o755);
      await expect(snapshotHost(bin, { procs: true })).rejects.toThrow(
        OsfactsClientError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a version it does not speak", () => {
    expect(() => parseSnapshotOutput("V\t1\nP\t1\t0\tlaunchd\n")).toThrow(
      OsfactsClientError,
    );
    expect(() => parseSnapshotOutput("P\t1\t0\tlaunchd\n")).toThrow(
      OsfactsClientError,
    );
    try {
      parseSnapshotOutput("V\t1\n");
    } catch (e) {
      expect(e).toBeInstanceOf(OsfactsClientError);
      expect((e as OsfactsClientError).kind).toBe("version");
      expect((e as Error).message).toContain(String(OSFACTS_FORMAT_VERSION));
    }
  });

  it("fails loudly on every row it cannot read", () => {
    const bad = [
      "V\t2\nP\t1\t0\n",
      "V\t2\nP\tnotapid\t0\tlaunchd\n",
      "V\t2\nM\t1\t0\textra\n",
      "V\t2\nS\t1\t9999999999999999\n",
      "V\t2\nC\t1\tnot-a-time\n",
      "V\t2\nL\towned\t1\t-\t8080\t00000000\n",
      "V\t2\nL\tclaimed\t-\t-\t8080\t00000000\n",
      "V\t2\nL\tunclaimed\t1\t-\t8080\t00000000\n",
      // pid 0 is the kernel's swapper, never a userspace listener. The `H`
      // row refused it from the start; the `L` row let it through, because
      // the same rule was written twice and the copies drifted. One
      // `attribution` reader now states it once.
      "V\t2\nL\tclaimed\t0\t-\t8080\t00000000\n",
      "V\t2\nL\tclaimed\t1\t-\t70000\t00000000\n",
      "V\t2\nL\tclaimed\t1\t-\t8080\tzz000000\n",
      "V\t2\nU\tnotapid\tports\tEACCES\n",
      "V\t2\nU\t1\tunknown\tEACCES\n",
      "V\t2\nE\tproc_net_dev\tnet\tEPERM\n",
      "V\t2\nX\t1\t2\t3\n",
      // An EMPTY field, not a missing one: `Number("")` is 0, so these used to
      // parse as a plausible reading. `arity` counts fields and never looks
      // inside them, so nothing downstream caught it.
      "V\t2\nP\t\t0\tlaunchd\n",
      "V\t2\nM\t1\t\n",
      "V\t2\nSTAT\t1\tR\t\t12\n",
      "V\t2\nSTAT\t1\tR\t \t12\n",
    ];
    for (const body of bad) {
      expect(() => parseSnapshotOutput(body)).toThrow(OsfactsClientError);
    }
  });

  it("refuses a host document — the two verbs are two contracts", () => {
    expect(() => parseSnapshotOutput(HOST_SAMPLE)).toThrow(OsfactsClientError);
  });
});

describe("parseHostOutput", () => {
  it("reads the v2 HLOAD/HMEM/HSWAP/HUP/HCPU/HNET/HDISK/E contract", () => {
    const r = parseHostOutput(HOST_SAMPLE);
    expect(r.load).toEqual({ one: 0.5, five: 1, fifteen: 1.5 });
    // The field is `memory`, matching the JSON face. It could not be, while
    // one type stood for both verbs and `memory` meant per-process RSS.
    expect(r.memory).toEqual({ totalBytes: 16000, availableBytes: 8000 });
    expect(r.swap).toEqual({ totalBytes: 2000, usedBytes: 100 });
    expect(r.uptimeUs).toBe(123456);
    expect(r.cpus).toEqual([
      {
        core: 0,
        userUs: 10,
        systemUs: 20,
        idleUs: 30,
        otherUs: 40,
        model: "Apple M1 Max",
        frequencyMhz: null,
      },
    ]);
    expect(r.networks).toEqual([{ name: "en0", rxBytes: 100, txBytes: 200 }]);
    expect(r.disks).toEqual([
      { mount: "/", totalBytes: 1000, availableBytes: 700, freeBytes: 800 },
    ]);
    expect(r.errors).toEqual([
      { source: "sysinfo_networks", facet: "net", code: "BLIND_OR_EMPTY" },
    ]);
  });

  it("refuses a snapshot document — and a snapshot's facet vocabulary", () => {
    expect(() => parseHostOutput(SNAPSHOT_SAMPLE)).toThrow(OsfactsClientError);
    expect(() =>
      parseHostOutput("V\t2\nE\tdarwin_tcp_pcblist\tports_unclaimed\tX\n"),
    ).toThrow(OsfactsClientError);
  });
});

describe("parseSocketHoldersOutput", () => {
  it("reads the v2 H/P/U/E contract", () => {
    const r = parseSocketHoldersOutput(HOLDERS_SAMPLE);
    expect(r.holders).toEqual([
      { status: "claimed", pid: 4242 },
      { status: "unclaimed" },
    ]);
    expect(r.procs).toEqual([{ pid: 4242, ppid: 4200, name: "kaval" }]);
    expect(r.unreadable).toEqual([
      { pid: 4243, facet: "proc", errno: "ESRCH" },
    ]);
    expect(r.errors).toEqual([
      {
        source: "darwin_proc_fds",
        facet: "socket_holders",
        code: "BLIND_OR_EMPTY",
      },
    ]);
  });

  /** The three answers a consumer must never collapse into one another. */
  it("keeps nobody-holds-it, cannot-name-it, and could-not-look apart", () => {
    expect(parseSocketHoldersOutput("V\t2\n")).toEqual({
      holders: [],
      procs: [],
      unreadable: [],
      errors: [],
    });
    expect(parseSocketHoldersOutput("V\t2\nH\tunclaimed\t-\n").holders).toEqual(
      [{ status: "unclaimed" }],
    );
    expect(
      parseSocketHoldersOutput(
        "V\t2\nE\tproc_net_unix\tsocket_holders\tEACCES\n",
      ),
    ).toMatchObject({ holders: [], errors: [{ facet: "socket_holders" }] });
  });

  it("fails loudly on every row it cannot read", () => {
    const bad = [
      "V\t2\nH\tclaimed\t-\n",
      "V\t2\nH\tunclaimed\t4242\n",
      "V\t2\nH\theld\t4242\n",
      "V\t2\nH\tclaimed\t0\n",
      "V\t2\nH\tclaimed\tnotapid\n",
      "V\t2\nH\tclaimed\n",
      "V\t2\nH\tclaimed\t4242\textra\n",
      "V\t2\nU\t1\tunknown\tEACCES\n",
      // A snapshot's own facet vocabulary — the verbs are separate contracts.
      "V\t2\nE\tproc_net_tcp\tports\tEACCES\n",
    ];
    for (const body of bad) {
      expect(() => parseSocketHoldersOutput(body)).toThrow(OsfactsClientError);
    }
  });

  it("refuses the other verbs' documents", () => {
    expect(() => parseSocketHoldersOutput(SNAPSHOT_SAMPLE)).toThrow(
      OsfactsClientError,
    );
    expect(() => parseSocketHoldersOutput(HOST_SAMPLE)).toThrow(
      OsfactsClientError,
    );
  });
});

describe("socketHolders", () => {
  it("spawns the verb with the path, and pays for --procs only when asked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-holders");
    try {
      // Echoes its own argv back as the holder's NAME, so the assertion below
      // is about the real command line, not a mock's idea of it.
      await writeFile(
        bin,
        '#!/bin/sh\nprintf "V\\t2\\nH\\tclaimed\\t7\\nP\\t7\\t1\\t%s\\n" "$*"\n',
      );
      await chmod(bin, 0o755);
      await expect(
        socketHolders(bin, "/run/user/1000/kaval.sock"),
      ).resolves.toMatchObject({
        holders: [{ status: "claimed", pid: 7 }],
        procs: [{ name: "socket-holders /run/user/1000/kaval.sock" }],
      });
      await expect(
        socketHolders(bin, "/run/user/1000/kaval.sock", { procs: true }),
      ).resolves.toMatchObject({
        procs: [{ name: "socket-holders /run/user/1000/kaval.sock --procs" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses an empty path rather than asking about some other socket", () => {
    expect(() => socketHolders("/bin/true", "")).toThrow(OsfactsClientError);
  });

  it("keeps the E rows of a blind walk that exited non-zero", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-blind-holders");
    try {
      await writeFile(
        bin,
        '#!/bin/sh\nprintf "V\\t2\\nE\\tdarwin_proc_fds\\tsocket_holders\\tBLIND_OR_EMPTY\\n"\nexit 1\n',
      );
      await chmod(bin, 0o755);
      await expect(socketHolders(bin, "/run/a.sock")).resolves.toMatchObject({
        holders: [],
        errors: [{ facet: "socket_holders", code: "BLIND_OR_EMPTY" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("a refused ask is never an empty answer", () => {
  /**
   * The binary writes its version line on the USAGE path too, so a document
   * shape alone cannot tell an answer from a refusal. An older binary that
   * does not have the verb the caller asked for exits 2 after that version
   * line — and reading it as a well-formed "nothing found" is how a supervisor
   * would conclude a live socket is free.
   */
  it("refuses a usage-error document (exit 2) rather than parsing it as nothing-found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-older");
    try {
      await writeFile(
        bin,
        '#!/bin/sh\nprintf "V\\t2\\n"\necho "osfacts: unknown command \'socket-holders\'" >&2\nexit 2\n',
      );
      await chmod(bin, 0o755);
      await expect(socketHolders(bin, "/run/a.sock")).rejects.toThrow(
        /unknown command/,
      );
      await expect(snapshotHost(bin, { procs: true })).rejects.toThrow(
        OsfactsClientError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The sync twin must obey the SAME exit-status rule as the async one.
 *
 * It nearly did not: `promisify(execFile)` reports the exit status on `.code`,
 * but `execFileSync` throws the raw spawnSync result, whose status is
 * `.status` and which carries no `.code` at all. A guard reading only `.code`
 * is therefore silently inert here — it discards the binary's documented
 * exit-1 document (losing the `E` rows that name which source went blind) and
 * would equally have failed to refuse an exit-2 usage document. These pins
 * exist so the twins cannot drift apart again.
 */
describe("the sync twin obeys the same exit-status rule", () => {
  async function withStub<T>(
    body: string,
    run: (bin: string) => T,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "osfacts-client-"));
    const bin = join(dir, "osfacts-stub");
    try {
      await writeFile(bin, body);
      await chmod(bin, 0o755);
      return run(bin);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("keeps the E rows of a totally-blind probe that exited non-zero", async () => {
    await withStub(
      '#!/bin/sh\nprintf "V\\t2\\nE\\tproc_readdir\\tproc\\tEACCES\\n"\nexit 1\n',
      (bin) =>
        expect(snapshotPidsSync(bin, [1], { startTime: true })).toMatchObject({
          startTimes: [],
          errors: [{ source: "proc_readdir", facet: "proc", code: "EACCES" }],
        }),
    );
  });

  it("refuses a usage-error document (exit 2) rather than parsing it as nothing-found", async () => {
    await withStub(
      '#!/bin/sh\nprintf "V\\t2\\n"\necho "osfacts: unknown command" >&2\nexit 2\n',
      (bin) =>
        expect(() => snapshotPidsSync(bin, [1], { startTime: true })).toThrow(
          /unknown command/,
        ),
    );
  });

  it("names the exit status when the failure is not a spawn errno", async () => {
    await withStub("#!/bin/sh\nexit 2\n", (bin) =>
      expect(() => snapshotPidsSync(bin, [1], { startTime: true })).toThrow(
        /exit 2/,
      ),
    );
  });

  it("still fails loudly when a non-zero exit produced no document", async () => {
    await withStub("#!/bin/sh\necho boom >&2\nexit 3\n", (bin) =>
      expect(() => snapshotPidsSync(bin, [1], { startTime: true })).toThrow(
        OsfactsClientError,
      ),
    );
  });
});
