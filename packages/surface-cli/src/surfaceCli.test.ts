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

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { Effect, FileSystem, Layer, Path, Sink, Stdio, Terminal } from "effect";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { UnixSocketListener } from "@kolu/surface/unix-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT } from "./exit";
import { fixtureRoot, serveFixture } from "./fixture.testlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, "host.fixture.ts");
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");

let dir: string;
let socketPath: string;
let listener: UnixSocketListener;
/** A path in the test dir that nothing is serving — what a case points at when
 *  it must prove the request never LEFT the process. Pointing at the live socket
 *  would prove nothing (a usage error and a successful dial look the same from
 *  outside); pointing here makes exit 2 the only way to pass, because a dial
 *  would have answered exit 3. */
let deadSocket: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "surface-cli-"));
  socketPath = join(dir, "fixture.sock");
  deadSocket = join(dir, "nobody-here.sock");
  listener = await serveFixture(socketPath, silentLogger);
  expect(listener.outcome).toEqual({ kind: "listening" });
});

afterAll(() => {
  listener?.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Read a spawned child to completion — both channels as text, plus the code a
 *  shell would report for it.
 *
 *  ONE harness for all four spawns below, which differ only in what they spawn
 *  and (for `follow`) in what they do to the child while it runs. Written out
 *  per spawn, the exit-code normalisation below was in three of the four and
 *  missing from the fourth, which is precisely the drift a fourth copy invites.
 *
 *  `watch` sees stdout as it accumulates, which is what lets a case act on the
 *  running process — `follow` Ctrl-Cs it after the first ndjson line. */
function collect(
  child: ChildProcess,
  watch?: (stdout: string) => void,
): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      watch?.(stdout);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk) => {
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
  });
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
  const child = spawn(TSX, [HOST, ...argv], {
    stdio: ["pipe", "pipe", "pipe"],
    env:
      opts?.fixture === undefined
        ? process.env
        : { ...process.env, SURFACE_CLI_FIXTURE: opts.fixture },
  });
  child.stdin?.end(opts?.stdin ?? "");
  return collect(child);
}

/** Spawn, wait for the first ndjson line, then Ctrl-C it — the `--follow`
 *  lifecycle a user drives with a keyboard. */
function follow(args: readonly string[]): Promise<Run> {
  const child = spawn(TSX, [HOST, ...args, "--socket", socketPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let interrupted = false;
  return collect(child, (stdout) => {
    if (!interrupted && stdout.includes("\n")) {
      interrupted = true;
      child.kill("SIGINT");
    }
  });
}

/** Run a streaming read with its stdout piped into `head -1` — a reader that
 *  takes one line and hangs up, which is the ordinary shape of `… | head` and
 *  the one an EPIPE arrives from. The exit code is the CLI's, not `head`'s. */
function pipeThroughHead(args: readonly string[]): Promise<Run> {
  // `bash` and `pipefail`, deliberately: a plain pipeline reports the LAST
  // stage's status, which is `head`'s 0 whatever the CLI did — so the case
  // would pass without measuring anything. With `pipefail` the status is the
  // CLI's whenever the CLI is the one that failed, which is exactly the
  // discrimination this case exists to make.
  return collect(
    spawn(
      "bash",
      [
        "-c",
        `set -o pipefail; "$0" "$@" --socket "${socketPath}" | head -1`,
        TSX,
        HOST,
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}

/** Build a command tree with `fixtureCommands`' options overridden, and report
 *  whether the BUILD refused. A malformed tree is an author's mistake with no
 *  CLI to read the refusal off, so the proof is a process that fails to start. */
/** The same, for the HELP page — which is where a group's wording is checked,
 *  because that is where a group is read. Same shape of proof: an author's
 *  mistake has no CLI to be reported on, so the process must refuse to start. */
function buildHelp(help: string): Promise<Run> {
  const script = `
    import { surfaceHelp } from "./src/commands.ts";
    import { EXPOSE, endpointFlags, HELP, resolveFixture, surface, VERBS } from "./src/fixture.testlib.ts";
    surfaceHelp({
      surface,
      expose: EXPOSE,
      verbs: VERBS,
      endpoint: { flags: endpointFlags, resolve: resolveFixture },
      info: { name: "demo" },
      help: ${help},
    });
  `;
  return collect(
    spawn(TSX, ["--eval", script], {
      cwd: join(HERE, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

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
  return collect(
    spawn(TSX, ["--eval", script], {
      cwd: join(HERE, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
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
    // `proc.reap` is a REAL procedure of the fixture's spec that neither map
    // names, beside `proc.kill` which one of them does — so the two are the same
    // shape of member and the only difference between them is the map. (This
    // case used to assert `system_live` was absent, which no expose map can
    // decide: `defineSurface` reserves the `system/*` members on the GROUP and
    // never puts them in `spec`, and the projection walks the spec — so it
    // passed with `EXPOSE` deleted entirely.)
    expect(help.stdout).toContain("proc_kill");
    expect(help.stdout).not.toContain("proc_reap");
  });

  it("`list` answers the table this face offers, with each verb's own input", async () => {
    // `--json` asks for the DATA. Without it `list` writes its aligned table,
    // whatever stdout is attached to — the flag is the only thing that decides
    // (which is why the same name had to stop meaning the whole input; that is
    // `--input` now).
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
    // EXACT, not `arrayContaining`: a member silently dropped from the
    // projection is precisely what this table is for, and a containment
    // assertion cannot see one go missing.
    expect(
      [...table.resources].sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "autosave", kind: "event" },
      { name: "load", kind: "cell" },
      { name: "mounts", kind: "collection" },
      { name: "nodeLog", kind: "stream" },
      { name: "processes", kind: "collection" },
      { name: "ticks", kind: "stream" },
      // Offered by the CLI and WITHHELD by the served face — the two gates are
      // separate decisions, and this table is the CLI's.
      { name: "withheld", kind: "cell" },
    ]);
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
      // BOTH directions, on one verb: the whole input as JSON, and the whole
      // answer as JSON. Two names because they are two things.
      "--input",
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
    expect(JSON.parse(killed.stdout)).toMatchObject({
      ok: true,
      saw: {
        signal: "TERM",
        because: ["noisy", "slow"],
        labels: { team: "infra", why: "test" },
      },
    });
  });

  it("refuses a value the enum does not admit, without dialling anything", async () => {
    const bad = await run(["proc_kill", "42", "--signal", "HUP"], {
      socket: deadSocket,
    });
    // The library's own parse refusal, which `runEdge` maps onto THIS face's
    // usage arm — the whole reason `runEdge` exists, so the matrix is true of a
    // binary and not only of the failures this package raises itself.
    expect(bad.code).toBe(EXIT.usage);
    // Effect CLI renders its own refusals: the reason on stderr, and the usage
    // document on STDOUT. That is the one documented exception to "stdout is
    // data", and it is the library's, not this face's — pinned so a change in
    // either direction is seen.
    expect(bad.stderr).toContain("HUP");
    expect(bad.stdout).not.toBe("");
  });

  it("takes the whole input as JSON, and from stdin with `-`", async () => {
    // The count itself is whatever earlier cases left behind — what is pinned
    // is that the EMPTY object reached the verb as its whole input.
    const viaFlag = await run(["proc_count", "--input", "{}", "--json"]);
    expect(viaFlag.code).toBe(EXIT.ok);
    expect(JSON.parse(viaFlag.stdout)).toMatchObject({ n: expect.any(Number) });

    const viaStdin = await run(["echo", "--input", "-"], {
      stdin: JSON.stringify("from stdin"),
    });
    expect(viaStdin.code).toBe(EXIT.ok);
    expect(JSON.parse(viaStdin.stdout)).toEqual({ said: "from stdin" });
  });

  it("keeps the boolean flag a TRISTATE — said, said-not, and not said are three payloads", async () => {
    // `Flag.boolean` without a parser default is what makes this possible, and
    // it is load-bearing: a verb cannot tell "the caller asked for false" from
    // "the caller said nothing" if the projection invents one. Each case spends
    // its own pid, since a kill succeeds at most once per pid.
    const said = await run(["proc_kill", "101", "--force"]);
    expect(said.code).toBe(EXIT.ok);
    expect(JSON.parse(said.stdout)).toMatchObject({ saw: { force: true } });

    const denied = await run(["proc_kill", "102", "--no-force"]);
    expect(denied.code).toBe(EXIT.ok);
    expect(JSON.parse(denied.stdout)).toMatchObject({ saw: { force: false } });

    const silent = await run(["proc_kill", "103"]);
    expect(silent.code).toBe(EXIT.ok);
    const saw = (JSON.parse(silent.stdout) as { saw: Record<string, unknown> })
      .saw;
    expect(Object.hasOwn(saw, "force")).toBe(false);
  });

  it("takes the float, the plain string and the deep field's own JSON", async () => {
    const killed = await run([
      "proc_kill",
      "104",
      "--after",
      "1.5",
      "--reason",
      "it stopped answering",
      "--trace",
      '{"id":"abc"}',
    ]);
    expect(killed.code).toBe(EXIT.ok);
    expect(JSON.parse(killed.stdout)).toMatchObject({
      saw: {
        after: 1.5,
        reason: "it stopped answering",
        trace: { id: "abc" },
      },
    });
  });

  it("refuses a deep field whose value is not JSON, naming the flag", async () => {
    const nope = await run(["proc_kill", "7", "--trace", "nope"], {
      socket: deadSocket,
    });
    expect(nope.code).toBe(EXIT.usage);
    expect(`${nope.stdout}${nope.stderr}`).toContain("trace");
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

  it("does not report a read that RAN OUT OF TIME as a successful absence", async () => {
    // `mounts` declares no `keys` verb, so a read of a key it does not hold
    // has no membership signal to resolve against and is bounded by the timer
    // alone: the item stream stays open saying nothing until the deadline.
    // Nothing was found out — neither that the item is there nor that it is
    // gone — so this must not answer on the code that means "the verb did what
    // it was asked", where a reaper would read the absence as evidence.
    const timedOut = await run(["get", "mounts", "not-a-mount"]);
    expect(timedOut.code).toBe(EXIT.unreachable);
    expect(timedOut.stdout).toBe("");
    // The three facts a caller can act on: which member, which key, and how
    // long it waited.
    expect(timedOut.stderr).toContain("mounts");
    expect(timedOut.stderr).toContain("not-a-mount");
    expect(timedOut.stderr).toContain("5000");
  }, 20_000);

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
    // `--json` because what is pinned here is WHERE the endpoint flag parses,
    // and the answer has to be machine-readable to say so; the fixture's verb
    // carries a renderer, which is the default now.
    const before = await run(["proc_count", "--json"], {
      fixture: "parent-flags",
      flagFirst: true,
    });
    expect(before.code).toBe(EXIT.ok);
    expect(JSON.parse(before.stdout)).toMatchObject({ n: expect.any(Number) });
  });

  it("still parses the flag AFTER the verb, so neither spelling is lost", async () => {
    const after = await run(["proc_count", "--json"], {
      fixture: "parent-flags",
    });
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
    const bad = await run(["proc_kill", "7", "--input", "{not json"], {
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
describe("a field that can be CLEARED takes text, or the word", () => {
  // A nullable field is a UNION, and a union falls to the JSON flag — so on a
  // surface where "or clear it with null" is the ordinary way to spell a
  // removable field, the most-used write verbs each wanted a shell-quoted JSON
  // string for a plain line of text (`--note '"the brass ones"'`), and the
  // refusal for getting it wrong read as a complaint about the value rather
  // than as a fact about the flag. Found driving olai's own `set_desc`.

  it("takes the plain text a reader would type", async () => {
    // Proven by what the verb SAW, not by the exit code: the whole failure this
    // fixes is a value arriving in the wrong shape.
    const killed = await run([
      "proc_kill",
      "105",
      "--note",
      "the brass ones",
      "--json",
    ]);
    expect(killed.code).toBe(EXIT.ok);
    expect(JSON.parse(killed.stdout)).toMatchObject({
      saw: { pid: 105, note: "the brass ones" },
    });
  });

  it("takes the word `null` as the clearing it is", async () => {
    const cleared = await run(["proc_kill", "106", "--note", "null", "--json"]);
    expect(cleared.code).toBe(EXIT.ok);
    // `null` the VALUE, not the four letters — which is the whole distinction,
    // and the one a `toMatchObject` on a string would have missed.
    expect(JSON.parse(cleared.stdout).saw.note).toBeNull();
  });

  it("does the same for a nullable NUMBER, whose parser would have refused the word", async () => {
    const every = await run(["proc_kill", "107", "--every", "7", "--json"]);
    expect(JSON.parse(every.stdout).saw.every).toBe(7);

    const none = await run(["proc_kill", "108", "--every", "null", "--json"]);
    expect(JSON.parse(none.stdout).saw.every).toBeNull();

    // …and a value that is neither is refused, in words naming BOTH ways in.
    const bad = await run(["proc_kill", "4305", "--every", "soon"], {
      socket: deadSocket,
    });
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.stderr + bad.stdout).toContain("null");
  });

  it("lists the word beside the choices, for a nullable enum", async () => {
    const help = await run(["proc_kill", "--help"], { socket: deadSocket });
    expect(help.stdout).toContain("fast");
    expect(help.stdout).toContain("slow");
    // The help line says what the word does, and where a literal "null" goes —
    // a magic word a reader is not told about is one they find out about by
    // having it not work.
    expect(help.stdout).toContain("clears it");
    expect(help.stdout).toContain("--input");

    const chosen = await run(["proc_kill", "110", "--mode", "fast", "--json"]);
    expect(JSON.parse(chosen.stdout).saw.mode).toBe("fast");
    const unchosen = await run([
      "proc_kill",
      "111",
      "--mode",
      "null",
      "--json",
    ]);
    expect(JSON.parse(unchosen.stdout).saw.mode).toBeNull();
  });

  it("leaves the literal four letters reachable, through --input", async () => {
    // The ambiguity, priced and paid: a note whose text IS "null" cannot be
    // written with the flag, and the escape hatch has no ambiguity at all. It is
    // the one case the flag gives up, and it is named on the flag's own line.
    const literal = await run([
      "proc_kill",
      "--input",
      JSON.stringify({ pid: 112, note: "null" }),
      "--json",
    ]);
    expect(literal.code).toBe(EXIT.ok);
    expect(JSON.parse(literal.stdout).saw.note).toBe("null");
  });

  it("leaves a union that is NOT one scalar plus null on the JSON flag", async () => {
    // `trace` is a nullable-free object, so it keeps the field's-own-JSON
    // spelling it always had: the new arm is exactly `<scalar> | null` and
    // nothing wider, because nothing wider has one obvious spelling to take.
    const traced = await run([
      "proc_kill",
      "109",
      "--trace",
      '{"id":"x"}',
      "--json",
    ]);
    expect(JSON.parse(traced.stdout).saw.trace).toEqual({ id: "x" });
  });
});

describe("the whole-input escape hatch is reachable on every verb", () => {
  // The hatch is spelled `--input` here and was spelled `--json` when these
  // cases were written. Nothing about WHAT they pin moved: the name did, because
  // `--json` now asks for the whole ANSWER (`JSON_FLAG`), and one name cannot
  // mean the input on the way in and the output on the way out.
  it("takes --input on a verb whose input declares a REQUIRED field", async () => {
    // The parser used to demand the field flags first — a required field became
    // a required argv param, enforced before the assembler could see that
    // `--input` was the answer. So the documented alternative was a dead branch
    // on every verb with a required field, which is most of them.
    const refused = await run(["proc_kill", "--input", '{"pid":4241}']);
    expect(refused.code).toBe(EXIT.failed);
    expect(JSON.parse(refused.stderr)).toMatchObject({
      _tag: "NoSuchPid",
      pid: 4241,
    });
  });

  it("takes --input - on the same verb, reading the payload from stdin", async () => {
    // Proven by the verb's own refusal carrying the pid back out: nothing else
    // in the pipeline could have invented 4242, so the stdin payload reached the
    // far side intact — and the assertion does not care what earlier cases left
    // in the table.
    const refused = await run(["proc_kill", "--input", "-"], {
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
    expect(bare.stderr).toContain("--input");
  });

  it("names the missing required field through --input too, in the SAME words", async () => {
    // Requiredness had two enforcers wording one mistake differently: the field
    // path named the field, while the documented alternative got "this input
    // does not match what the verb declares — {}" from the decode. The caller
    // who takes the documented route got the worse diagnostic.
    const bare = await run(["proc_kill", "--input", "{}"], {
      socket: deadSocket,
    });
    expect(bare.code).toBe(EXIT.usage);
    expect(bare.stderr).toContain("pid");
    expect(bare.stderr).toContain("--input");
  });

  it("refuses --input COMBINED with the field flags, and says which ones collide", async () => {
    // Pointed at the DEAD socket: the refusal must be raised before anything is
    // dialled, and a live socket could not tell the two apart.
    const both = await run(["proc_kill", "7", "--input", '{"pid":7}'], {
      socket: deadSocket,
    });
    expect(both.code).toBe(EXIT.usage);
    expect(both.stderr).toContain("--input");
    // Once each — a positional used to be counted twice, as a position and as
    // a field.
    expect(both.stderr.match(/"pid"/g)).toHaveLength(1);
  });

  it("is not refused because of a field the caller never typed", async () => {
    // An optional array flag parsed to `[]` rather than to absent, so every
    // `--input` on this verb was refused as "combined with because" — citing a
    // flag nobody passed — and every call sent `because: []` where the schema's
    // `optionalKey` means the key is not there at all.
    const answered = await run(["proc_kill", "--input", '{"pid":4243}']);
    expect(answered.code).not.toBe(EXIT.usage);
    expect(answered.stderr).not.toContain("because");
  });

  it("reports an EMPTY stdin as the usage error it is, on this face's code", async () => {
    // The payload arrives through the `Stdio` service the handler already
    // requires, not off fd 0 synchronously inside the assembly — so a read that
    // produces nothing is answered, on exit 2, rather than swallowed.
    const empty = await run(["proc_kill", "--input", "-"], {
      socket: deadSocket,
      stdin: "",
    });
    expect(empty.code).toBe(EXIT.usage);
    expect(empty.stderr).toMatch(/--input|stdin/);
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

  it("renders the SAME thing on a TTY and through a pipe — the flag decides, not the descriptor", async () => {
    // THE RULE THIS PINS IS THE ABSENCE OF A RULE. The renderer used to apply
    // on a terminal and not through a pipe, so `proc_count` and
    // `proc_count | tee` answered with different things and neither could be
    // asked for on purpose: a script that wanted the summary could not have it,
    // a human who wanted the data had to pipe it somewhere, and the same command
    // in a CI log said something else again. Ruled out (human, 2026-08-23).
    //
    // The fixture's renderer answers in a shape the JSON never has, so neither
    // half of this can pass by accident against the other branch.
    const argv = ["proc_count", "--socket", socketPath];
    expect(await runWithStdout(argv, true)).toMatch(/^processes: \d+\n$/);
    expect(await runWithStdout(argv, false)).toMatch(/^processes: \d+\n$/);

    // …and `--json` is the one thing that moves it, on both.
    const asked = [...argv, "--json"];
    expect(JSON.parse(await runWithStdout(asked, true))).toMatchObject({
      n: expect.any(Number),
    });
    expect(JSON.parse(await runWithStdout(asked, false))).toMatchObject({
      n: expect.any(Number),
    });
  });
});

describe("each flag means ONE thing across the mounted command set", () => {
  it("`--json` is the ANSWER, on `list` and on every verb alike", async () => {
    // `list` once had a `--json` switch forcing its data frame and lost it,
    // because the name also carried the whole INPUT on every verb — one name,
    // two directions. The input hatch is `--input` now, which gives the name
    // back: `--json` asks for the answer whole, wherever it is typed, and takes
    // no value anywhere.
    const help = await run(["list", "--help"], { socket: deadSocket });
    expect(help.stdout).toContain("--json");

    const table = await run(["list", "--json"], { socket: deadSocket });
    expect(table.code).toBe(EXIT.ok);
    expect(JSON.parse(table.stdout)).toMatchObject({
      verbs: expect.any(Array),
    });

    // It is a SWITCH, so a value after it is the next token — here a verb name
    // that `list` takes no argument for.
    const valued = await run(["list", "--json", "{}"], { socket: deadSocket });
    expect(valued.code).toBe(EXIT.usage);
  });

  it("`--input` is the INPUT, and `list` — which sends none — takes none", async () => {
    const help = await run(["list", "--help"], { socket: deadSocket });
    expect(help.stdout).not.toContain("--input");

    const refused = await run(["list", "--input", "{}"], {
      socket: deadSocket,
    });
    expect(refused.code).toBe(EXIT.usage);
  });
});

describe("a member's own refusal is not an unreachable endpoint", () => {
  it("reports a SERVER refusal on the verb's arm, not on the endpoint's", async () => {
    // The two gates are separate decisions: `withheld` is on the CLI's table and
    // off the served face's, so a user can type it and the server says no. That
    // refusal is the far side ANSWERING — exit 1, the verb's own arm — and not
    // exit 3, the code that tells a driver to try a different socket.
    //
    // The one-shot arm used to catch the whole failure channel of
    // `firstFrameOrThrow` and re-word every failure as a dropped link, so this
    // came back as `demo: no surface at …` while the SAME refusal under
    // `--follow` reported correctly. One member, two answers, decided by a flag.
    const refused = await run(["get", "withheld"]);
    expect(refused.code).toBe(EXIT.failed);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).not.toContain("no surface at");
    // Exit 1 means "the declared error, as JSON on stderr" for EVERY path that
    // reaches it. This one crosses the wire as a DEFECT (the serving face
    // refuses a member the CLI's map offers), and it used to leave the run edge
    // as prose on the same code — so a driver doing `JSON.parse(stderr)` on
    // exit 1 threw, on the arm the matrix promises it will not.
    expect(JSON.parse(refused.stderr)).toMatchObject({
      message: expect.any(String),
    });

    // And the two readings agree, which is the property that broke.
    const followed = await run(["get", "withheld", "--follow"]);
    expect(followed.code).toBe(EXIT.failed);
  });

  it("still reports a dead endpoint as exit 3", async () => {
    // The arm that survives: nothing serving is still the endpoint's fault.
    const dead = await run(["get", "load"], { socket: deadSocket });
    expect(dead.code).toBe(EXIT.unreachable);
    expect(dead.stderr).toContain("no surface at");
  });
});

describe("a help line carries the two facts the parser no longer does", () => {
  it("marks a required positional required, and invents no default for it", async () => {
    // Every positional was advertised `(default: {})`: the whole `defaults` Map
    // was passed where the value belonged, and a Map is never undefined and
    // stringifies to `{}`. The line whose entire job is to carry requiredness and
    // defaults was telling the reader they could omit a required argument.
    const help = await run(["proc_kill", "--help"], { socket: deadSocket });
    expect(help.code).toBe(EXIT.ok);
    expect(help.stdout).toContain("(required)");
    expect(help.stdout).not.toContain("(default:");
  });
});

describe("a transport that cannot push is projected without the verbs it cannot serve", () => {
  /** The `one-shot` fixture: the SAME live socket, projected with
   *  `endpoint.streaming: false` — so what changes between it and every other
   *  case in this file is the projection alone, never the link. */
  const oneShot = (args: readonly string[]): Promise<Run> =>
    run(args, { fixture: "one-shot" });

  it("mounts no `watch`, because `watch` IS the subscription", async () => {
    // Not "mounts one that refuses": a caller finds out what a face can do from
    // `--help`, and a command that parses and then always fails is a command
    // whose help is untrue. The same face over a duplex link mounts it — the
    // default fixture's own `watch` case, above, is the control.
    const help = await oneShot(["--help"]);
    expect(help.code).toBe(EXIT.ok);
    expect(help.stdout).not.toContain("watch");

    const asked = await oneShot(["watch", "processes"]);
    expect(asked.code).toBe(EXIT.usage);
  });

  it("declares no `--follow` on the readers it does mount", async () => {
    for (const verb of ["get", "keys"]) {
      const help = await oneShot([verb, "--help"]);
      expect(help.code).toBe(EXIT.ok);
      expect(help.stdout).not.toContain("--follow");
    }
  });

  it("still reads — the one-shot arm takes the opening frame and stops", async () => {
    // The subtraction is only of the streaming verbs. A door that answers once
    // answers every reader here, because every one of them is a first-frame read
    // with the rest interrupted.
    const load = await oneShot(["get", "load"]);
    expect(load.code).toBe(EXIT.ok);
    expect(JSON.parse(load.stdout)).toMatchObject({ one: expect.any(Number) });

    const keys = await oneShot(["keys", "processes"]);
    expect(keys.code).toBe(EXIT.ok);
    expect(JSON.parse(keys.stdout)).toEqual(expect.any(Array));
  });
});

describe("the help page a host writes is the page a person reads", () => {
  const helped = (args: readonly string[]): Promise<Run> =>
    run(args, { fixture: "helped", socket: deadSocket });

  it("prints the purpose, the groups, an example and the flags — in that order", async () => {
    const help = await helped(["--help"]);
    expect(help.code).toBe(EXIT.ok);
    // The whole page, pinned as one string: the layout IS the deliverable here,
    // and a set of `toContain`s would pass on a page whose lines came out in any
    // order at all.
    expect(help.stdout).toContain(
      [
        "Drive the demo surface from a shell.",
        "",
        "Usage",
        "  demo surface <verb> [flags]",
        "",
        "Read",
        // A usage wider than the column takes its sentence on the next line
        // rather than pushing every other line of the page right — which is what
        // makes this golden a test of the LAYOUT and not of the longest name.
        "  get <member> [key] [--follow]",
        "                              Read one exposed member — its current value, or (with --follow) its live subscription as ndjson.",
        "                              $ demo surface get processes 1",
        "  keys <collection> [--follow]",
        "                              List a collection's current key set — with --follow, every key set as it changes.",
        "  watch <collection>          Follow a collection: the whole set as one snapshot frame, then one ndjson line per batch of changes.",
        "  list                        List every verb and readable member this face offers.",
        "",
        "Write",
        "  proc_kill <pid> [flags]     Call proc_kill.",
        "                              $ demo surface proc_kill 4241 --signal HUP",
        "",
        "Ask",
        // The read-only marker a verb's own blurb carries, on the page as well as
        // in the agent's tool listing — one sentence, both faces.
        "  proc_count                  Call proc_count. (read-only)",
      ].join("\n"),
    );
  });

  it("names the host's own endpoint flag beside this face's two", async () => {
    const help = await helped(["--help"]);
    expect(help.stdout).toContain("--socket <path>");
    expect(help.stdout).toContain("--json");
    expect(help.stdout).toContain("--input <json>");
    expect(help.stdout).toContain(
      "Answers go to stdout; anything else goes to stderr.",
    );
  });

  it("gives a verb no group claimed a group of its own, rather than dropping it", async () => {
    // `echo` is in no group in the fixture's wording. A verb added to a table is
    // a command with no code written for it, so a help page that REFUSED until
    // somebody filed it would put that cost straight back — and one that
    // silently omitted it would ship a command nobody can find.
    const help = await helped(["--help"]);
    expect(help.stdout).toContain("Other");
    expect(help.stdout).toContain("echo");
  });

  it("does not ALSO print the renderer's flat listing of the same verbs", async () => {
    // Two listings on one page — one grouped, one alphabetical — and the flat
    // one reads like the truth because the renderer wrote it. So the page is the
    // listing, or the renderer's is; never both.
    const help = await helped(["--help"]);
    expect(help.stdout).not.toContain("SUBCOMMANDS");

    // …and every command is still there, still with its own help.
    const verb = await helped(["proc_kill", "--help"]);
    expect(verb.code).toBe(EXIT.ok);
    expect(verb.stdout).toContain("--signal");
  });

  it("shows a verb's TITLE, not the paragraphs its description carries", async () => {
    // A description is written for an AGENT — it is what a tool listing carries
    // before something chooses a tool — so an app that has thought about its
    // agents has descriptions that run to paragraphs. One per row is not a help
    // page, it is a wall, and the flat listing this page replaces was more
    // readable than that. So the row shows the verb's `title`: MCP's own display
    // name, already written, already short.
    const help = await helped(["--help"]);
    expect(help.stdout).toContain("Echo a line");
    expect(help.stdout).not.toContain("IT TAKES A BARE SCALAR");

    // …and the description is still there, in full, where a reader asks for
    // that one verb.
    const verb = await helped(["echo", "--help"]);
    expect(verb.stdout).toContain("IT TAKES A BARE SCALAR");
  }, 30_000);

  it("falls back to the first SENTENCE for a verb with no title", async () => {
    // `proc_kill` has neither, so it gets the plain line naming it; the readers
    // have their own one-liners. What is pinned here is that a page never
    // carries a second paragraph on a row.
    const help = await helped(["--help"]);
    const rows = help.stdout.split("\n");
    const write = rows.findIndex((line) => line.trim() === "Write");
    expect(rows[write + 1]).toContain("Call proc_kill.");
  }, 30_000);

  it("refuses at BUILD a group that names a command this surface has none of", async () => {
    // An author's mistake, with no CLI to read the refusal off — so the proof is
    // a process that will not start. The stale group is the failure mode: a help
    // page is the doc, and a doc describing a verb that is gone is worse than no
    // doc.
    const built = await buildHelp(
      `{ ...HELP, groups: [{ title: "Read", verbs: ["proc_reticulate"] }] }`,
    );
    expect(built.code).not.toBe(0);
    expect(built.stderr).toContain("proc_reticulate");
  });

  it("refuses at BUILD a command named by two groups", async () => {
    const built = await buildHelp(
      `{ ...HELP, groups: [{ title: "Read", verbs: ["list"] }, { title: "Write", verbs: ["list"] }] }`,
    );
    expect(built.code).not.toBe(0);
    expect(built.stderr).toContain('"list"');
  });
});
