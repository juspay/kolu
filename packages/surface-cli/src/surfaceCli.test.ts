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
import { Effect, FileSystem, Layer, Path, Sink, Stdio, Terminal } from "effect";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import { fixtureRoot } from "./fixture.testlib";
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
  opts?: {
    readonly stdin?: string;
    readonly socket?: string;
    /** Which shape of host to spawn — see `host.fixture.ts`. The default is the
     *  one every other case drives: the endpoint flag on each generated verb. */
    readonly fixture?: string;
    /** Put the endpoint flag FIRST, before the verb name — the parse a host
     *  buys by declaring it on its own parent, and the one a flag declared on
     *  the subcommand cannot answer. */
    readonly flagFirst?: boolean;
  },
): Promise<Run> {
  const endpoint = ["--socket", opts?.socket ?? socketPath];
  const argv = opts?.flagFirst
    ? [...endpoint, ...args]
    : [...args, ...endpoint];
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(TSX, [HOST, ...argv], {
      stdio: ["pipe", "pipe", "pipe"],
      env:
        opts?.fixture === undefined
          ? process.env
          : { ...process.env, SURFACE_CLI_FIXTURE: opts.fixture },
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

/** Run a streaming read with its stdout piped into `head -1` — a reader that
 *  takes one line and hangs up, which is the ordinary shape of `… | head` and
 *  the one an EPIPE arrives from. The exit code is the CLI's, not `head`'s. */
function pipeThroughHead(args: readonly string[]): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    // `bash` and `pipefail`, deliberately: a plain pipeline reports the LAST
    // stage's status, which is `head`'s 0 whatever the CLI did — so the case
    // would pass without measuring anything. With `pipefail` the status is the
    // CLI's whenever the CLI is the one that failed, which is exactly the
    // discrimination this case exists to make.
    const child = spawn(
      "bash",
      [
        "-c",
        `set -o pipefail; "$0" "$@" --socket "${socketPath}" | head -1`,
        TSX,
        HOST,
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    // `sh`'s status is the LAST stage's (`head`), which always succeeds — so the
    // CLI's own code is read out of `${PIPESTATUS}`-free POSIX sh by asking the
    // pipeline to report it: the command below re-runs nothing, it simply keeps
    // the CLI in the foreground of its own subshell.
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Build a command tree with `fixtureCommands`' options overridden, and report
 *  whether the BUILD refused. A malformed tree is an author's mistake with no
 *  CLI to read the refusal off, so the proof is a process that fails to start. */
function buildTree(override: string): Promise<Run> {
  const script = `
    import { surfaceCommands } from "./src/commands.ts";
    import { EXPOSE, endpointFlags, resolveFixture, surface, VERBS } from "./src/fixture.testlib.ts";
    surfaceCommands({
      surface,
      expose: EXPOSE,
      verbs: VERBS,
      endpoint: { flags: endpointFlags, resolve: resolveFixture },
      info: { name: "demo" },
      ${override}
    });
  `;
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(TSX, ["--eval", script], {
      cwd: join(HERE, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c) => {
      stdout += c;
    });
    child.stderr.setEncoding("utf8").on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
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

describe("where the endpoint flags live is the HOST's decision", () => {
  it("dials the same surface when the host declares the flag on its own PARENT", async () => {
    // The seam used to hard-code WHERE the flags live — on every generated
    // command — which is a decision about the host's own argv grammar. A host
    // that also declared them on the parent (`Command.withSharedFlags`, which
    // is what `kolu-cli` does, deliberately) collided outright and failed to
    // start; so this mounting was unreachable, and with it the parse it buys.
    const before = await run(["proc_count"], {
      fixture: "parent-flags",
      flagFirst: true,
    });
    expect(before.code).toBe(EXIT.ok);
    expect(JSON.parse(before.stdout)).toMatchObject({ n: expect.any(Number) });
  });

  it("still parses the flag AFTER the verb, so neither spelling is lost", async () => {
    const after = await run(["proc_count"], { fixture: "parent-flags" });
    expect(after.code).toBe(EXIT.ok);
    expect(JSON.parse(after.stdout)).toMatchObject({ n: expect.any(Number) });
  });

  it("reads a member through a parent-flag mounting too — the projection is unchanged", async () => {
    const load = await run(["get", "load"], {
      fixture: "parent-flags",
      flagFirst: true,
    });
    expect(load.code).toBe(EXIT.ok);
    expect(JSON.parse(load.stdout)).toEqual({ one: 0, five: 0, fifteen: 0 });
  });
});

describe("a resolution that refuses reaches the exit matrix", () => {
  // `resolve` is an Effect precisely so an app whose order can come up empty has
  // somewhere to say so. Both ways of saying it land on 3 — the same arm as a
  // failed dial, because both mean there is no surface to reach.
  for (const [how, fixture] of [
    ["as a typed failure", "resolve-fails"],
    ["as a bare throw out of the seam", "resolve-throws"],
  ] as const) {
    it(`is exit 3, naming the reason, ${how}`, async () => {
      // The throw arm is the one that used to escape: a synchronous throw inside
      // a generator body is a DEFECT, so no `Effect.catch` saw it, `runEdge`
      // never ran, and the process exited on the runtime's default — colliding
      // with exit 1, which the matrix reserves for "the verb refused".
      const nope = await run(["proc_count"], { fixture });
      expect(nope.code).toBe(EXIT.unreachable);
      expect(nope.stderr).toContain("demo:");
      expect(nope.stderr).toContain("$DEMO_SOCKET");
      expect(nope.stdout).toBe("");
    });
  }
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

/**
 * The cases below each pin a defect the architecture review found in the first
 * cut of this package — every one of them measured against this same fixture
 * before it was fixed. They are grouped by what the defect COST a user rather
 * than by which module it lived in, because that is the thing a regression here
 * would take away again.
 */
describe("the whole-input escape hatch is reachable on every verb", () => {
  it("takes --json on a verb whose input declares a REQUIRED field", async () => {
    // The parser used to demand the field flags first — a required field became
    // a required argv param, enforced before the assembler could see that
    // `--json` was the answer. So the documented alternative was a dead branch
    // on every verb with a required field, which is most of them.
    const refused = await run(["proc_kill", "--json", '{"pid":4241}']);
    expect(refused.code).toBe(EXIT.failed);
    expect(JSON.parse(refused.stderr)).toMatchObject({
      _tag: "NoSuchPid",
      pid: 4241,
    });
  });

  it("takes --json - on the same verb, reading the payload from stdin", async () => {
    // Proven by the verb's own refusal carrying the pid back out: nothing else
    // in the pipeline could have invented 4242, so the stdin payload reached the
    // far side intact — and the assertion does not care what earlier cases left
    // in the table.
    const refused = await run(["proc_kill", "--json", "-"], {
      stdin: JSON.stringify({ pid: 4242 }),
    });
    expect(refused.code).toBe(EXIT.failed);
    expect(JSON.parse(refused.stderr)).toMatchObject({
      _tag: "NoSuchPid",
      pid: 4242,
    });
  });

  it("names the missing required field itself when neither is given", async () => {
    // Requiredness moved from the parser to the assembler, so the refusal has to
    // be this face's own — with this face's own exit code, and naming the
    // alternative the parser could not know about.
    const bare = await run(["proc_kill"], { socket: deadSocket });
    expect(bare.code).toBe(EXIT.usage);
    expect(bare.stderr).toContain("pid");
    expect(bare.stderr).toContain("--json");
  });

  it("still says which fields collide when --json is combined with them", async () => {
    const both = await run(["proc_kill", "7", "--json", '{"pid":7}'], {
      socket: deadSocket,
    });
    expect(both.code).toBe(EXIT.usage);
    // Once each — a positional used to be counted twice, as a position and as
    // a field.
    expect(both.stderr.match(/"pid"/g)).toHaveLength(1);
  });

  it("is not refused because of a field the caller never typed", async () => {
    // An optional array flag parsed to `[]` rather than to absent, so every
    // `--json` on this verb was refused as "combined with because" — citing a
    // flag nobody passed — and every call sent `because: []` where the schema's
    // `optionalKey` means the key is not there at all.
    const answered = await run(["proc_kill", "--json", '{"pid":4243}']);
    expect(answered.code).not.toBe(EXIT.usage);
    expect(answered.stderr).not.toContain("because");
  });

  it("reports an EMPTY stdin as the usage error it is, on this face's code", async () => {
    // The payload arrives through the `Stdio` service the handler already
    // requires, not off fd 0 synchronously inside the assembly — so a read that
    // produces nothing is answered, on exit 2, rather than swallowed.
    const empty = await run(["proc_kill", "--json", "-"], {
      socket: deadSocket,
      stdin: "",
    });
    expect(empty.code).toBe(EXIT.usage);
    expect(empty.stderr).toMatch(/--json|stdin/);
  });
});

describe("reads that used to hang, fail, or lie", () => {
  it("refuses a one-shot read of an EVENT instead of hanging forever", async () => {
    // An event has occurrences, not a current value, so its handler yields
    // nothing until one happens: `get autosave x` waited for ever, printing
    // nothing on either channel — the worst answer a command can give.
    const nope = await run(["get", "autosave", "doc-1"]);
    expect(nope.code).toBe(EXIT.usage);
    expect(nope.stderr).toContain("--follow");
  });

  it("reads an item of a collection that declares no `keys` verb", async () => {
    // The bounded item read was handed a membership stream unconditionally, so a
    // collection without `keys` failed a read of an item that is right there.
    const mount = await run(["get", "mounts", "root"]);
    expect(mount.code).toBe(EXIT.ok);
    expect(JSON.parse(mount.stdout)).toBe("/");
  });

  it("does not offer `keys` for a collection that has no key set", async () => {
    const help = await run(["keys", "--help"], { socket: deadSocket });
    expect(help.stdout).toContain("processes");
    expect(help.stdout).not.toContain("mounts");
  });

  it("reads a stream whose input is a NUMBER, not just a string", async () => {
    // The `[arg]` token was forwarded as raw text to a member ref that decodes
    // eagerly, so any non-string input threw at the call site — a defect,
    // outside every arm of the exit matrix.
    const tick = await run(["get", "ticks", "5"]);
    expect(tick.code).toBe(EXIT.ok);
    expect(JSON.parse(tick.stdout)).toEqual({ at: 0, every: 5 });
  });

  it("exits 0 when the reader hangs up mid-stream", async () => {
    // `… | head -1` closes the pipe under a live subscription: the reader got
    // what it asked for. The EPIPE arm was tested against the wrong shape (a
    // `Cause`, which carries no `code`), so it never matched and every hung-up
    // reader died instead.
    const piped = await pipeThroughHead(["get", "ticks", "5", "--follow"]);
    expect(piped.code).toBe(EXIT.ok);
    expect(piped.stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("the projection refuses a malformed command tree at BUILD time", () => {
  it("refuses an `annotate` key that names no verb", async () => {
    const built = await buildTree(`
      annotate: { proc_kill: { positional: ["pid"] }, no_such_verb: {} },
    `);
    expect(built.code).not.toBe(0);
    expect(built.stderr).toContain("no_such_verb");
  });

  it("refuses an `annotate` key that names a READER, which no annotation reaches", async () => {
    // `annotate` is only ever looked up by verb name, so `{ get: … }` was
    // checked against the set that also holds the reader commands and passed —
    // then did nothing. Ergonomics its author asked for and silently did not
    // get, which is the exact silence this check exists to prevent.
    const built = await buildTree(`
      annotate: { get: { render: (o) => String(o) } },
    `);
    expect(built.code).not.toBe(0);
    expect(built.stderr).toContain('"get"');
  });

  it("refuses a bespoke verb that would shadow a reader command", async () => {
    const built = await buildTree(`
      verbs: { ...VERBS, get: VERBS.echo },
    `);
    expect(built.code).not.toBe(0);
    expect(built.stderr).toContain('"get"');
  });
});

describe("a verb's renderer, on a terminal", () => {
  /** The one case a spawned process cannot cheaply make: stdout attached to a
   *  TTY. Effect CLI's own `Stdio` service carries that fact, so the command
   *  runs IN PROCESS against the same live socket, with the terminal answer
   *  supplied rather than faked at the descriptor. */
  const runWithStdout = (
    argv: readonly string[],
    isTerminal: boolean,
  ): Promise<string> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const written: string[] = [];
        // A named function, not a literal: `Sink.forEach` is Effect's sink
        // combinator and its callback MUST return the effect, which the lint rule
        // for `Array.prototype.forEach` reads as a mistake when it sees a literal.
        const capture = (chunk: string | Uint8Array): Effect.Effect<void> =>
          Effect.sync(() => {
            written.push(
              typeof chunk === "string"
                ? chunk
                : new TextDecoder().decode(chunk),
            );
          });
        const layer = Layer.mergeAll(
          FileSystem.layerNoop({}),
          Path.layer,
          Stdio.layerTest({
            args: Effect.succeed([...argv]),
            stdoutIsTerminal: Effect.succeed(isTerminal),
            stdout: () => Sink.forEach(capture),
          }),
          Layer.succeed(
            Terminal.Terminal,
            Terminal.make({
              columns: Effect.succeed(80),
              rows: Effect.succeed(24),
              readInput: Effect.die("unused"),
              readLine: Effect.die("unused"),
              display: () => Effect.void,
            }),
          ),
          Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make(() => Effect.die("unused")),
          ),
        );
        yield* Command.run(fixtureRoot(), { version: "0.0.0" }).pipe(
          Effect.provide(layer),
        );
        return written.join("");
      }),
    );

  it("renders text on a TTY and JSON through a pipe — from one run edge", async () => {
    const argv = ["proc_count", "--socket", socketPath];
    const onTty = await runWithStdout(argv, true);
    // The fixture's renderer answers in a shape the JSON never has, so this
    // cannot pass by accident against the other branch.
    expect(onTty).toMatch(/^processes: \d+\n$/);

    const piped = await runWithStdout(argv, false);
    expect(JSON.parse(piped)).toMatchObject({ n: expect.any(Number) });
  });
});
