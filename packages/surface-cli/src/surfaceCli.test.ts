/**
 * The projection, driven end to end: a REAL surface served over a REAL unix
 * socket (`serveOverUnixSocket`), and a REAL process on the other end of it
 * (`host.fixture.ts` under `tsx`), one spawn per case.
 *
 * A process and not an in-process run, because three things in this package's
 * contract are only true of one: the exit matrix, a Ctrl-C during `--follow`
 * (a signal, an interrupt, code 130), and "stdout is data" — a pipe, not a
 * captured sink. An in-process assertion proves the Effect that WOULD produce
 * them; only a process proves they arrive.
 *
 * What is pinned here is the FACE, never the wording of a help screen beyond the
 * facts it must carry: which verbs exist, which flags each takes, what shape the
 * data has, and which code comes back.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import type { UnixSocketListener } from "@kolu/surface/unix-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT } from "./exit";
import { serveFixture } from "./fixture.testlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, "host.fixture.ts");
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");

let dir: string;
let socketPath: string;
let listener: UnixSocketListener;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "surface-cli-"));
  socketPath = join(dir, "fixture.sock");
  deadSocket = join(dir, "nobody-here.sock");
  ({ listener } = await serveFixture(socketPath, silentLogger));
  expect(listener.outcome).toEqual({ kind: "listening" });
});

afterAll(() => {
  listener?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A path in the test dir that nothing is serving — what a case points at
 *  when it must prove the request never LEFT the process. Pointing at the live
 *  socket would prove nothing (a usage error and a successful dial look the
 *  same from outside); pointing here makes exit 2 the only way to pass, because
 *  a dial would have answered exit 3. */
let deadSocket: string;

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the fixture host with `args`, against the live socket unless the case
 *  deliberately points elsewhere. */
function run(
  args: readonly string[],
  opts?: { readonly stdin?: string; readonly socket?: string },
): Promise<Run> {
  const argv = [...args, "--socket", opts?.socket ?? socketPath];
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(TSX, [HOST, ...argv], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      // A child killed by a signal reports `code: null`; the shell's own
      // rendering of that is 128 + the signal number, which is where 130 comes
      // from for SIGINT. Normalising here keeps every case asserting ONE thing.
      resolve({
        code: code ?? (signal === "SIGINT" ? 130 : 1),
        stdout,
        stderr,
      }),
    );
    if (opts?.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

/** Spawn, wait for the first ndjson line, then Ctrl-C it — the `--follow`
 *  lifecycle a user drives with a keyboard. */
function follow(args: readonly string[]): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(TSX, [HOST, ...args, "--socket", socketPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let interrupted = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      if (!interrupted && stdout.includes("\n")) {
        interrupted = true;
        child.kill("SIGINT");
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({
        code: code ?? (signal === "SIGINT" ? 130 : 1),
        stdout,
        stderr,
      }),
    );
  });
}

const lines = (text: string): unknown[] =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);

describe("the command table", () => {
  it("mounts one command per exposed procedure, per bespoke verb, and the readers", async () => {
    const help = await run(["--help"], { socket: deadSocket });
    expect(help.code).toBe(EXIT.ok);
    // The verbs carry the flat name the MCP face uses — `proc.kill` is
    // `proc_kill` on both, computed by the one `toolName`.
    for (const name of [
      "proc_kill",
      "proc_count",
      "echo",
      "get",
      "keys",
      "watch",
      "list",
    ]) {
      expect(help.stdout).toContain(name);
    }
  });

  it("does not mount a verb the expose map withholds", async () => {
    const help = await run(["--help"], { socket: deadSocket });
    // `system.live` and its two siblings are on every surface's group and are
    // named by no expose map — default-deny means they never reach argv.
    expect(help.stdout).not.toContain("system_live");
  });

  it("`list` answers the table this face offers, with each verb's own input", async () => {
    const listed = await run(["list", "--json"]);
    expect(listed.code).toBe(EXIT.ok);
    const table = JSON.parse(listed.stdout) as {
      verbs: {
        name: string;
        source: string;
        mutates: boolean;
        input: unknown;
      }[];
      resources: { name: string; kind: string }[];
    };
    expect(table.verbs.map((verb) => verb.name)).toEqual([
      "echo",
      "proc_count",
      "proc_kill",
    ]);
    expect(
      table.verbs.find((verb) => verb.name === "proc_count")?.mutates,
    ).toBe(false);
    // An unannotated verb is MUTATING — the conservative default the whole
    // stack shares, read here through the CLI's own table.
    expect(table.verbs.find((verb) => verb.name === "proc_kill")?.mutates).toBe(
      true,
    );
    expect(table.verbs.find((verb) => verb.name === "echo")?.source).toBe(
      "bespoke",
    );
    expect(table.resources).toEqual(
      expect.arrayContaining([
        { name: "load", kind: "cell" },
        { name: "processes", kind: "collection" },
        { name: "nodeLog", kind: "stream" },
        { name: "autosave", kind: "event" },
      ]),
    );
    // The advertised input is the SAME document the MCP face publishes.
    expect(
      table.verbs.find((verb) => verb.name === "proc_count")?.input,
    ).toEqual({ type: "object", properties: {} });
  });
});

describe("the flag shapes a verb's input projects to", () => {
  it("names every field, by its own spelling, with the endpoint flags beside them", async () => {
    const help = await run(["proc_kill", "--help"], { socket: deadSocket });
    expect(help.code).toBe(EXIT.ok);
    for (const flag of [
      "--signal",
      "--because",
      "--labels",
      "--json",
      "--socket",
    ]) {
      expect(help.stdout).toContain(flag);
    }
    // `pid` is annotated positional, so it is an ARGUMENT and not a flag.
    expect(help.stdout).not.toContain("--pid");
    expect(help.stdout).toContain("pid");
  });

  it("takes a positional, an enum flag, a repeated flag and a k=v flag in one call", async () => {
    const killed = await run([
      "proc_kill",
      "7",
      "--signal",
      "TERM",
      "--because",
      "noisy",
      "--because",
      "slow",
      "--labels",
      "team=infra",
      "--labels",
      "why=test",
    ]);
    expect(killed.code).toBe(EXIT.ok);
    expect(JSON.parse(killed.stdout)).toEqual({ ok: true });
  });

  it("refuses a value the enum does not admit, without dialling anything", async () => {
    const bad = await run(["proc_kill", "42", "--signal", "HUP"], {
      socket: deadSocket,
    });
    // The library's own parse refusal — exit 1 is the host's arm for
    // "already on screen", and what matters is that it never left the process.
    expect(bad.code).not.toBe(EXIT.ok);
    expect(`${bad.stdout}${bad.stderr}`).toContain("HUP");
  });

  it("takes the whole input as JSON, and from stdin with `-`", async () => {
    // The count itself is whatever earlier cases left behind — what is pinned
    // is that the EMPTY object reached the verb as its whole input.
    const viaFlag = await run(["proc_count", "--json", "{}"]);
    expect(viaFlag.code).toBe(EXIT.ok);
    expect(JSON.parse(viaFlag.stdout)).toMatchObject({ n: expect.any(Number) });

    const viaStdin = await run(["echo", "--json", "-"], {
      stdin: JSON.stringify("from stdin"),
    });
    expect(viaStdin.code).toBe(EXIT.ok);
    expect(JSON.parse(viaStdin.stdout)).toEqual({ said: "from stdin" });
  });

  it("refuses --json COMBINED with the field flags rather than silently preferring one", async () => {
    const both = await run(["proc_kill", "7", "--json", '{"pid":7}']);
    expect(both.code).toBe(EXIT.usage);
    expect(both.stderr).toContain("--json");
  });

  it("takes a bespoke verb's scalar input as the bare positional", async () => {
    const said = await run(["echo", "hello there"]);
    expect(said.code).toBe(EXIT.ok);
    expect(JSON.parse(said.stdout)).toEqual({ said: "hello there" });
  });
});

describe("reading members", () => {
  it("reads a cell's opening snapshot and stops", async () => {
    const load = await run(["get", "load"]);
    expect(load.code).toBe(EXIT.ok);
    expect(JSON.parse(load.stdout)).toEqual({ one: 0, five: 0, fifteen: 0 });
  });

  it("reads a collection ITEM by its key, decoded into the key's declared type", async () => {
    const proc = await run(["get", "processes", "42"]);
    expect(proc.code).toBe(EXIT.ok);
    expect(JSON.parse(proc.stdout)).toMatchObject({ command: "node" });
  });

  it("answers a MISSING key as an absence rather than hanging on it", async () => {
    const absent = await run(["get", "processes", "999"]);
    expect(absent.code).toBe(EXIT.ok);
    expect(JSON.parse(absent.stdout)).toMatchObject({
      present: false,
      why: "absent",
    });
  });

  it("reads a stream's snapshot with its input as the argument", async () => {
    const log = await run(["get", "nodeLog", "node-1"]);
    expect(log.code).toBe(EXIT.ok);
    expect(JSON.parse(log.stdout)).toEqual({
      kind: "snapshot",
      text: "opened node-1",
    });
  });

  it("lists a collection's keys", async () => {
    const keys = await run(["keys", "processes"]);
    expect(keys.code).toBe(EXIT.ok);
    expect(JSON.parse(keys.stdout)).toEqual(expect.arrayContaining([42]));
  });

  it("follows a subscription as ndjson — one compact line per frame", async () => {
    const followed = await follow(["keys", "processes", "--follow"]);
    expect(followed.code).toBe(EXIT.interrupted);
    const frames = lines(followed.stdout);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    // ndjson is compact whatever stdout is attached to: a frame that spans
    // lines is not a frame a reader can split on.
    expect(followed.stdout.trimEnd().split("\n").length).toBe(frames.length);
  });

  it("watches a collection — the snapshot frame first", async () => {
    const watched = await follow(["watch", "processes"]);
    expect(watched.code).toBe(EXIT.interrupted);
    const [first] = lines(watched.stdout);
    expect(first).toMatchObject({ kind: "snapshot" });
  });

  it("refuses a member name nothing exposes, and says what IS exposed", async () => {
    const nope = await run(["get", "nope"]);
    expect(nope.code).toBe(EXIT.usage);
    expect(nope.stderr).toContain("load");
  });

  it("refuses a key the collection's key schema does not admit", async () => {
    const nope = await run(["get", "processes", "not-a-pid"]);
    expect(nope.code).toBe(EXIT.usage);
    expect(nope.stderr).toContain("not-a-pid");
  });
});

describe("the exit matrix", () => {
  it("0 — the verb did what it was asked", async () => {
    expect((await run(["proc_count"])).code).toBe(EXIT.ok);
  });

  it("1 — the verb's DECLARED error, as JSON on stderr and nothing on stdout", async () => {
    const refused = await run(["proc_kill", "999"]);
    expect(refused.code).toBe(EXIT.failed);
    expect(refused.stdout).toBe("");
    expect(JSON.parse(refused.stderr)).toMatchObject({
      _tag: "NoSuchPid",
      pid: 999,
    });
  });

  it("2 — a usage error, raised before anything is dialled", async () => {
    const bad = await run(["proc_kill", "7", "--json", "{not json"], {
      socket: deadSocket,
    });
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.stderr).toContain("demo:");
  });

  it("3 — nothing is serving there, naming the endpoint", async () => {
    const nope = await run(["proc_count"], { socket: deadSocket });
    expect(nope.code).toBe(EXIT.unreachable);
    expect(nope.stderr).toContain(deadSocket);
  });

  it("130 — Ctrl-C during a --follow", async () => {
    const followed = await follow(["get", "load", "--follow"]);
    expect(followed.code).toBe(EXIT.interrupted);
  });
});
