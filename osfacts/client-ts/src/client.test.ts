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
  "V\t1",
  "P\t1\t0\tlaunchd",
  "P\t4200\t1\tzsh",
  "P\t4242\t4200\tnode",
  "L\t4242\t5173\t7f000001",
  `L\t4242\t8081\t${V4_MAPPED_LOOPBACK}`,
  "U\t991\tEACCES",
  "",
].join("\n");

describe("parseOsfactsOutput", () => {
  it("reads P, L (raw address), and U rows", () => {
    const r = parseOsfactsOutput(SAMPLE);
    expect(r.procs).toEqual([
      { pid: 1, ppid: 0, name: "launchd" },
      { pid: 4200, ppid: 1, name: "zsh" },
      { pid: 4242, ppid: 4200, name: "node" },
    ]);
    expect(r.ports).toEqual([
      { pid: 4242, port: 5173, address: "7f000001" },
      { pid: 4242, port: 8081, address: V4_MAPPED_LOOPBACK },
    ]);
    expect(r.unreadable).toEqual([{ pid: 991, errno: "EACCES" }]);
  });

  it("refuses a version it does not speak", () => {
    expect(() => parseOsfactsOutput("V\t2\nP\t1\t0\tlaunchd\n")).toThrow(
      OsfactsClientError,
    );
    expect(() => parseOsfactsOutput("P\t1\t0\tlaunchd\n")).toThrow(
      OsfactsClientError,
    );
    try {
      parseOsfactsOutput("V\t2\n");
    } catch (e) {
      expect(e).toBeInstanceOf(OsfactsClientError);
      expect((e as OsfactsClientError).kind).toBe("version");
      expect((e as Error).message).toContain(String(OSFACTS_FORMAT_VERSION));
    }
  });

  it("fails loudly on every row it cannot read", () => {
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
      expect(() => parseOsfactsOutput(body)).toThrow(OsfactsClientError);
    }
  });
});
