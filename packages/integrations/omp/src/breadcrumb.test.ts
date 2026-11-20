import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseSessionFileName,
  readBreadcrumb,
  ttyIdForPid,
} from "./breadcrumb.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-omp-crumb-"));

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SESSION_ID = "01a0a0e3-1843-701b-bfde-c9c816e3e92f";
const SESSION_FILE = `2026-09-14T17-07-12-579Z_${SESSION_ID}.jsonl`;
const STARTED_AT = Date.parse("2026-09-14T17:07:12.579Z");

function crumb(
  name: string,
  opts: { target: boolean; fresh?: boolean },
): { file: string; target: string } {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, SESSION_FILE);
  if (opts.target) fs.writeFileSync(target, "{}\n");
  const file = path.join(dir, "crumb");
  const lines = ["/work/proj", target];
  if (opts.fresh) lines.push("fresh");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return { file, target };
}

const found = (target: string) => ({
  kind: "found",
  session: { id: SESSION_ID, transcriptPath: target, startedAt: STARTED_AT },
});

describe("parseSessionFileName", () => {
  it("reads the id and the creation instant", () => {
    expect(parseSessionFileName(SESSION_FILE)).toEqual({
      id: SESSION_ID,
      startedAt: STARTED_AT,
    });
  });

  it("returns null for a name that carries neither", () => {
    expect(parseSessionFileName("x.jsonl")).toBeNull();
    expect(parseSessionFileName(`${SESSION_FILE}.bak`)).toBeNull();
    expect(parseSessionFileName("2026-09-14T17-07-12-579Z_.jsonl")).toBeNull();
  });
});

describe("readBreadcrumb", () => {
  it("reads omp's two-line crumb into a session", () => {
    const { file, target } = crumb("two-line", { target: true });
    expect(readBreadcrumb(file)).toEqual(found(target));
  });

  it("honours a `fresh` crumb whose session file has not materialized", () => {
    const { file, target } = crumb("fresh", { target: false, fresh: true });
    expect(readBreadcrumb(file)).toEqual(found(target));
  });

  it("reports ABSENT when omp itself would ignore the crumb", () => {
    expect(readBreadcrumb(path.join(tmp, "never-written"))).toEqual({
      kind: "absent",
    });
    const { file } = crumb("stale", { target: false });
    expect(readBreadcrumb(file)).toEqual({ kind: "absent" });
    const junkDir = path.join(tmp, "stale-and-unnameable");
    fs.mkdirSync(junkDir, { recursive: true });
    const junkCrumb = path.join(junkDir, "crumb");
    fs.writeFileSync(
      junkCrumb,
      `/work/proj\n${path.join(junkDir, "junk.jsonl")}\n`,
    );
    const errors: unknown[] = [];
    expect(
      readBreadcrumb(junkCrumb, {
        error: (...args: unknown[]) => errors.push(args),
      } as never),
    ).toEqual({ kind: "absent" });
    expect(errors).toEqual([]);
  });

  it("reports UNUSABLE for a crumb it cannot read", () => {
    expect(readBreadcrumb(tmp)).toEqual({ kind: "unusable" });
    if (typeof process.getuid !== "function" || process.getuid() !== 0) {
      const { file } = crumb("no-perm", { target: true });
      fs.chmodSync(file, 0o000);
      try {
        expect(readBreadcrumb(file)).toEqual({ kind: "unusable" });
      } finally {
        fs.chmodSync(file, 0o600);
      }
    }
  });

  it("reports UNUSABLE for a crumb that names no session", () => {
    const half = path.join(tmp, "half");
    fs.writeFileSync(half, "/work/proj\n");
    expect(readBreadcrumb(half)).toEqual({ kind: "unusable" });
    const dir = path.join(tmp, "unnameable");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, "junk.jsonl");
    fs.writeFileSync(target, "{}\n");
    const file = path.join(dir, "crumb");
    fs.writeFileSync(file, `/work/proj\n${target}\n`);
    expect(readBreadcrumb(file)).toEqual({ kind: "unusable" });
  });
});

describe("ttyIdForPid", () => {
  it("derives omp's tty id for this process on Linux", () => {
    if (process.platform !== "linux") return;
    const id = ttyIdForPid(process.pid);
    const stdin = fs.readlinkSync("/proc/self/fd/0");
    if (stdin.startsWith("/dev/")) {
      expect(id).toBe(stdin.slice("/dev/".length).replace(/\//g, "-"));
    } else {
      expect(id).toBeNull();
    }
  });

  it("returns null for a pid that does not exist", () => {
    expect(ttyIdForPid(2 ** 22)).toBeNull();
  });
});
