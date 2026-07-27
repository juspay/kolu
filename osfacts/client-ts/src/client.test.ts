/**
 * Contract pins for the client — fixtures only, no OS. Spawn round-trips
 * against a real binary live in the consumer (padi) live suite.
 */

import { describe, expect, it } from "vitest";
import {
  OsfactsClientError,
  parseOsfactsOutput,
  OSFACTS_FORMAT_VERSION,
} from "./client.ts";

const V4_MAPPED_LOOPBACK = "00000000000000000000ffff7f000001";

const SAMPLE = [
  "V\t2",
  "P\t1\t0\tlaunchd",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  "M\t4242\t12345678",
  "S\t4242\t1710000000123456",
  "C\t4242\t987654",
  "L\tclaimed\t4242\t1000\t5173\t7f000001",
  `L\tunclaimed\t-\t0\t8081\t${V4_MAPPED_LOOPBACK}`,
  "U\t991\tports\tEACCES",
  "E\tdarwin_tcp_pcblist\tBLIND_OR_EMPTY",
  "",
].join("\n");

describe("parseOsfactsOutput", () => {
  it("reads the v2 P/M/S/C/L/U/E contract", () => {
    const r = parseOsfactsOutput(SAMPLE);
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
      { source: "darwin_tcp_pcblist", code: "BLIND_OR_EMPTY" },
    ]);
  });

  it("refuses a version it does not speak", () => {
    expect(() => parseOsfactsOutput("V\t1\nP\t1\t0\tlaunchd\n")).toThrow(
      OsfactsClientError,
    );
    expect(() => parseOsfactsOutput("P\t1\t0\tlaunchd\n")).toThrow(
      OsfactsClientError,
    );
    try {
      parseOsfactsOutput("V\t1\n");
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
      "V\t2\nL\tclaimed\t1\t-\t70000\t00000000\n",
      "V\t2\nL\tclaimed\t1\t-\t8080\tzz000000\n",
      "V\t2\nU\tnotapid\tports\tEACCES\n",
      "V\t2\nU\t1\tunknown\tEACCES\n",
      "V\t2\nX\t1\t2\t3\n",
    ];
    for (const body of bad) {
      expect(() => parseOsfactsOutput(body)).toThrow(OsfactsClientError);
    }
  });
});
