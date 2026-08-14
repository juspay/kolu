/**
 * What counts as "a usable kolu is on this host", against real subprocesses.
 *
 * The detection is a probe, so the fixtures are EXECUTABLES: a `kolu` written
 * into a directory this test hands to `detect` as its PATH, answering the way
 * a real one would. Nothing here talks to a padi daemon — what is asserted is
 * the RULE, and the rule is that only an answered identity read counts.
 *
 * The middle case is the one that matters most, and the reason this package
 * exists rather than a version check: a `kolu` that speaks the protocol
 * perfectly and reaches no daemon is exactly what a stale bundled build looks
 * like (juspay/kolu#2146, and #2148 for why the handshake alone proves
 * nothing), and it must not become an app's MCP server.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detect, probe, PROBE_ID } from "./index.ts";

/** Every directory this test made, removed after each case. */
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A `kolu` in a directory of its own, running the given script under the
 *  interpreter this test is itself running under — so the fixture needs
 *  nothing on PATH, which is the one thing these cases are arranging. Returns
 *  the absolute path and the PATH to hand `detect`, which is that directory
 *  ALONE: a machine that really is running kolu (the ordinary one to develop
 *  this on) must not get to decide half of these cases. */
function koluOnPath(body: string): { bin: string; path: string } {
  return fileOnPath(`#!${process.execPath}\n${body}`);
}

/** The same, for cases about the FILE rather than what it says — a program
 *  this host cannot run is one of the ways a `kolu` on PATH fails, and it
 *  cannot be written as a script this interpreter would accept. */
function fileOnPath(contents: string): { bin: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
  made.push(dir);
  const bin = join(dir, "kolu");
  writeFileSync(bin, contents);
  chmodSync(bin, 0o755);
  return { bin, path: dir };
}

/**
 * What the probe has to ask for, spelled HERE rather than imported.
 *
 * These two strings are the guarantee this file exists to hold. A real kolu
 * completes `initialize`, lists all its tools and lists its resources with no
 * daemon behind it at all (juspay/kolu#2148) — only READING a cell the daemon
 * owns tells the two apart. Taking them from `index.ts` would move with a
 * probe quietly swapped to `tools/list` and go on passing, which is the
 * opposite of a lock.
 */
const ASKS = "resources/read";
const ABOUT = "surface://cells/identity";

/** A fixture answering the identity read the way the flag says: with what a
 *  live padi has, or with the error a kolu that reached no daemon sends. It
 *  answers NOTHING else, so a probe that stopped asking for the daemon's own
 *  cell fails these cases rather than passing them. It watches the bytes for
 *  those two strings rather than parsing frames — a substring watch is not a
 *  second framing implementation, and it is enough to say what was asked. */
const script = (reachable: boolean): string => `
const ANSWER = ${JSON.stringify(
  reachable
    ? { jsonrpc: "2.0", id: PROBE_ID, result: { contents: [] } }
    : {
        jsonrpc: "2.0",
        id: PROBE_ID,
        error: { code: -32603, message: "padi transport down" },
      },
)}
let heard = ""
process.stdin.on("data", (chunk) => {
  heard += chunk
  if (!heard.includes(${JSON.stringify(ASKS)}) || !heard.includes(${JSON.stringify(ABOUT)})) return
  heard = ""
  process.stdout.write(JSON.stringify(ANSWER) + "\\n")
})
`;

describe("detect — a usable kolu is a kolu that ANSWERED", () => {
  it("a kolu whose padi answers is reachable, at the path that answered", async () => {
    const { bin, path } = koluOnPath(script(true));

    expect(
      await detect({ path, socket: "/run/user/1000/padi-abc/padi.sock" }),
    ).toEqual({
      _tag: "reachable",
      server: {
        // The path that ANSWERED, absolute — not the word we looked up.
        command: bin,
        args: ["mcp"],
        env: { PADI_SOCKET: "/run/user/1000/padi-abc/padi.sock" },
      },
    });
  });

  it("no socket named forwards nothing — kolu resolves its own padi", async () => {
    const { path } = koluOnPath(script(true));

    const found = await detect({ path });
    expect(found._tag === "reachable" && found.server.env).toEqual({});
  });

  // The case this package exists for: a kolu that speaks the protocol
  // perfectly and reaches no daemon. It must be told apart from a working one,
  // and it must carry the server's OWN words — the caller words the sentence,
  // so the reason has to survive as data.
  it("a kolu that reached no padi is unreachable, carrying its own refusal", async () => {
    const { bin, path } = koluOnPath(script(false));

    expect(await detect({ path })).toEqual({
      _tag: "unreachable",
      command: bin,
      why: { _tag: "refused", said: "padi transport down" },
    });
  });

  it("a binary that is not kolu at all never answers, and says so at the deadline", async () => {
    const { bin, path } = koluOnPath(
      `process.stdout.write("hello from something else\\n")\nprocess.stdin.on("data", () => {})\n`,
    );

    // A tenth of a second rather than the five-second default: the only way to
    // exercise a deadline is to spend it, so the deadline is a parameter.
    const found = await detect({ path, deadlineMs: 150 });
    expect(found).toEqual({
      _tag: "unreachable",
      command: bin,
      why: { _tag: "timedOut", deadlineMs: 150 },
    });
  });

  it("a kolu that hangs up says so, and names no refusal it never made", async () => {
    const { bin, path } = koluOnPath(`process.exit(0)\n`);

    expect(await detect({ path })).toEqual({
      _tag: "unreachable",
      command: bin,
      why: { _tag: "closed" },
    });
  });

  // The one that does not arrive through the pipes at all. An exec failure is
  // an `error` EVENT on a child that has already been returned, and what
  // FOLLOWS it is our own write to a stdin that died with it — so this is also
  // the regression test for the race: unraced, the caller would be told about
  // a broken pipe instead of about the file that would not run.
  it("a file that will not run is named as one, not as a broken pipe", async () => {
    const { bin, path } = fileOnPath(
      "#!/nonexistent/interpreter\nnot a program\n",
    );

    const found = await detect({ path });
    expect(found).toMatchObject({ _tag: "unreachable", command: bin });
    expect(found._tag === "unreachable" && found.why._tag).toBe(
      "couldNotStart",
    );
    // …and NOT the sentence about our own end of the pipe.
    expect(JSON.stringify(found)).not.toContain("EPIPE");
    expect(JSON.stringify(found)).not.toContain("write after end");
  });

  it("does NOT leak the parent's PADI_SOCKET into a probe whose recipe carries none", async () => {
    // The probe and the recipe it hands back must be about the SAME padi. With
    // no socket named the returned `env` is `{}` — "kolu resolves its own" —
    // so a probe child that quietly INHERITED this process's PADI_SOCKET would
    // be interrogating a daemon the caller's real server will never dial: a
    // `reachable` earned against the wrong socket, or a refusal blamed on the
    // right one. The evidence has to come from the arrangement it describes.
    const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(dir);
    const sidecar = join(dir, "socket-seen");
    const bin = join(dir, "kolu");
    writeFileSync(
      bin,
      `#!${process.execPath}\n` +
        // Record what the child ACTUALLY inherited, then answer normally so
        // this case also proves the strip does not break a working probe.
        `require("node:fs").writeFileSync(${JSON.stringify(sidecar)}, process.env.PADI_SOCKET ?? "<unset>")\n` +
        script(true),
    );
    chmodSync(bin, 0o755);

    const before = process.env.PADI_SOCKET;
    process.env.PADI_SOCKET = "/parent/leaked.sock";
    try {
      const found = await detect({ path: dir });

      // The recipe says no socket travels…
      expect(found).toEqual({
        _tag: "reachable",
        server: { command: bin, args: ["mcp"], env: {} },
      });
      // …so the child that produced that evidence must have seen none either.
      expect(readFileSync(sidecar, "utf8")).toBe("<unset>");
    } finally {
      if (before === undefined) delete process.env.PADI_SOCKET;
      else process.env.PADI_SOCKET = before;
    }
  });

  it("forwards a NAMED socket to the probe child, not merely to the recipe", async () => {
    // The other half of the same invariant: when a socket IS named it must
    // reach the child, and it must be the caller's rather than whatever this
    // process happens to carry — otherwise stripping the inherited one would
    // have silently disarmed the forward.
    const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(dir);
    const sidecar = join(dir, "socket-seen");
    const bin = join(dir, "kolu");
    writeFileSync(
      bin,
      `#!${process.execPath}\n` +
        `require("node:fs").writeFileSync(${JSON.stringify(sidecar)}, process.env.PADI_SOCKET ?? "<unset>")\n` +
        script(true),
    );
    chmodSync(bin, 0o755);

    const before = process.env.PADI_SOCKET;
    process.env.PADI_SOCKET = "/parent/leaked.sock";
    try {
      const found = await detect({
        path: dir,
        socket: "/named/by-caller.sock",
      });

      expect(found._tag === "reachable" && found.server.env).toEqual({
        PADI_SOCKET: "/named/by-caller.sock",
      });
      expect(readFileSync(sidecar, "utf8")).toBe("/named/by-caller.sock");
    } finally {
      if (before === undefined) delete process.env.PADI_SOCKET;
      else process.env.PADI_SOCKET = before;
    }
  });

  it("nothing on PATH is its own arm — not a failure to explain", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(dir);

    // Whether an absence is worth reporting depends on facts kolu cannot see,
    // so this arm carries no reason and no path: it is the caller's to judge.
    expect(await detect({ path: dir })).toEqual({ _tag: "notOnPath" });
  });

  it("an empty PATH finds nothing rather than reading the environment's own", async () => {
    // The PATH is a parameter precisely so a caller's live one is what gets
    // probed — never this process's, which under a service is not the user's.
    //
    // A DECOY is planted on the real PATH for the run: asserting `notOnPath`
    // against an ambient PATH that happens to have no `kolu` would stay green
    // under the very regression this names (a `path ?? process.env.PATH`
    // default), which is only a live pin on a machine that is itself running
    // kolu. With the decoy, the claim is guarded everywhere.
    const decoy = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(decoy);
    const bin = join(decoy, "kolu");
    writeFileSync(bin, `#!${process.execPath}\n${script(true)}`);
    chmodSync(bin, 0o755);

    const before = process.env.PATH;
    process.env.PATH = decoy;
    try {
      expect(await detect({})).toEqual({ _tag: "notOnPath" });
    } finally {
      if (before === undefined) delete process.env.PATH;
      else process.env.PATH = before;
    }
  });

  it("a name that is present but NOT executable is skipped like a shell would", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(dir);
    writeFileSync(join(dir, "kolu"), "not executable");

    expect(await detect({ path: dir })).toEqual({ _tag: "notOnPath" });
  });

  it("searches PATH in order, taking the first executable kolu", async () => {
    const answering = koluOnPath(script(true));
    const refusing = koluOnPath(script(false));

    // The refusing one is FIRST, so a lookup that respected order finds it —
    // which is the whole #2146 hazard: a padi-spawned terminal prepends its
    // own bundled copy, and the first hit is what a spawn would run.
    const found = await detect({ path: `${refusing.path}:${answering.path}` });
    expect(found).toMatchObject({
      _tag: "unreachable",
      command: refusing.bin,
    });
  });
});

describe("probe — the conversation half, over a process the caller owns", () => {
  it("answers the deadline in the units the caller passed", async () => {
    // The fixture READS and never answers, which is what a wedge IS: a process
    // alive and holding its client. A fixture that exited would close the pipe
    // and take the other branch.
    const { bin } = koluOnPath(`process.stdin.on("data", () => {})\n`);
    const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });

    expect(await probe(child, 150)).toEqual({
      _tag: "timedOut",
      deadlineMs: 150,
    });
  });

  it("a refusal with no message of its own still says it was refused", async () => {
    const { bin } = koluOnPath(`
process.stdin.on("data", () => {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: ${PROBE_ID}, error: { code: -1 } }) + "\\n")
})
`);
    const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });

    // `said: null` rather than an invented sentence — the caller decides what
    // to say when the server said nothing.
    expect(await probe(child, 2_000)).toEqual({ _tag: "refused", said: null });
  });

  it("ignores everything that is not the answer to ITS request", async () => {
    // Handshake replies, notifications and outright noise all arrive on the
    // same pipe. Only the message under the probe's own id decides anything —
    // an answer under a different id is not an answer.
    const { bin } = koluOnPath(`
let heard = ""
process.stdin.on("data", (chunk) => {
  heard += chunk
  if (!heard.includes("resources/read")) return
  heard = ""
  process.stdout.write("not json at all\\n")
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: {} }) + "\\n")
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\\n")
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: ${PROBE_ID}, result: { contents: [] } }) + "\\n")
})
`);
    const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });

    expect(await probe(child, 2_000)).toEqual({ _tag: "answered" });
  });

  it("reads an answer split across chunk boundaries", async () => {
    // ndjson framing: a line can arrive in pieces, and a chunk can carry more
    // than one line. Writing the answer a byte at a time is the sharpest probe
    // of the buffering, and a reader that treated each chunk as a whole line
    // fails it.
    const { bin } = koluOnPath(`
const ANSWER = JSON.stringify({ jsonrpc: "2.0", id: ${PROBE_ID}, result: { contents: [] } }) + "\\n"
let heard = ""
process.stdin.on("data", (chunk) => {
  heard += chunk
  if (!heard.includes("resources/read")) return
  heard = ""
  for (const ch of ANSWER) process.stdout.write(ch)
})
`);
    const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });

    expect(await probe(child, 2_000)).toEqual({ _tag: "answered" });
  });

  it("kills the process it probed, either way", async () => {
    const { bin } = koluOnPath(`process.stdin.on("data", () => {})\n`);
    const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });

    await probe(child, 150);
    // The probe is never a client: the caller spawns its own server, so this
    // process must not be left holding a daemon connection.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(child.killed).toBe(true);
  });
});
