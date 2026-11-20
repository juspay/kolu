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

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function koluOnPath(body: string): { bin: string; path: string } {
  return fileOnPath(`#!${process.execPath}\n${body}`);
}

function fileOnPath(contents: string): { bin: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
  made.push(dir);
  const bin = join(dir, "kolu");
  writeFileSync(bin, contents);
  chmodSync(bin, 0o755);
  return { bin, path: dir };
}

const ASKS = "resources/read";
const ABOUT = "surface://cells/identity";

const script = (padi: "answers" | "noDaemon"): string => `
const ANSWER = ${JSON.stringify(
  padi === "answers"
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
    const { bin, path } = koluOnPath(script("answers"));

    expect(
      await detect({ path, socket: "/run/user/1000/padi-abc/padi.sock" }),
    ).toEqual({
      _tag: "reachable",
      server: {
        command: bin,
        args: ["mcp"],
        env: { PADI_SOCKET: "/run/user/1000/padi-abc/padi.sock" },
      },
    });
  });

  it("no socket named forwards nothing — kolu resolves its own padi", async () => {
    const { path } = koluOnPath(script("answers"));

    const found = await detect({ path });
    expect(found._tag === "reachable" && found.server.env).toEqual({});
  });

  it("a kolu that reached no padi is unreachable, carrying its own refusal", async () => {
    const { bin, path } = koluOnPath(script("noDaemon"));

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

  it("a file that will not run is named as one, not as a broken pipe", async () => {
    const { bin, path } = fileOnPath(
      "#!/nonexistent/interpreter\nnot a program\n",
    );

    const found = await detect({ path });
    expect(found).toMatchObject({ _tag: "unreachable", command: bin });
    expect(found._tag === "unreachable" && found.why._tag).toBe(
      "couldNotStart",
    );
    expect(JSON.stringify(found)).not.toContain("EPIPE");
    expect(JSON.stringify(found)).not.toContain("write after end");
  });

  it("does NOT leak the parent's PADI_SOCKET into a probe whose recipe carries none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(dir);
    const sidecar = join(dir, "socket-seen");
    const bin = join(dir, "kolu");
    writeFileSync(
      bin,
      `#!${process.execPath}\n` +
        `require("node:fs").writeFileSync(${JSON.stringify(sidecar)}, process.env.PADI_SOCKET ?? "<unset>")\n` +
        script("answers"),
    );
    chmodSync(bin, 0o755);

    const before = process.env.PADI_SOCKET;
    process.env.PADI_SOCKET = "/parent/leaked.sock";
    try {
      const found = await detect({ path: dir });

      expect(found).toEqual({
        _tag: "reachable",
        server: { command: bin, args: ["mcp"], env: {} },
      });
      expect(readFileSync(sidecar, "utf8")).toBe("<unset>");
    } finally {
      if (before === undefined) delete process.env.PADI_SOCKET;
      else process.env.PADI_SOCKET = before;
    }
  });

  it("forwards a NAMED socket to the probe child, not merely to the recipe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(dir);
    const sidecar = join(dir, "socket-seen");
    const bin = join(dir, "kolu");
    writeFileSync(
      bin,
      `#!${process.execPath}\n` +
        `require("node:fs").writeFileSync(${JSON.stringify(sidecar)}, process.env.PADI_SOCKET ?? "<unset>")\n` +
        script("answers"),
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

    expect(await detect({ path: dir })).toEqual({ _tag: "notOnPath" });
  });

  it("an empty PATH finds nothing rather than reading the environment's own", async () => {
    const decoy = mkdtempSync(join(tmpdir(), "kolu-detect-"));
    made.push(decoy);
    const bin = join(decoy, "kolu");
    writeFileSync(bin, `#!${process.execPath}\n${script("answers")}`);
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
    const answering = koluOnPath(script("answers"));
    const refusing = koluOnPath(script("noDaemon"));

    const found = await detect({ path: `${refusing.path}:${answering.path}` });
    expect(found).toMatchObject({
      _tag: "unreachable",
      command: refusing.bin,
    });
  });
});

describe("probe — the conversation half, over a process the caller owns", () => {
  it("answers the deadline in the units the caller passed", async () => {
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

    expect(await probe(child, 2_000)).toEqual({ _tag: "refused", said: null });
  });

  it("ignores everything that is not the answer to ITS request", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(child.killed).toBe(true);
  });
});
