/**
 * Antigravity core tests. Fixtures are invented, in the shapes `agy` 1.5.19
 * writes:
 *
 *   <tmp>/presence/<id>.lock
 *   <tmp>/cache/last_conversations.json
 *   <tmp>/brain/<id>/.system_generated/logs/transcript.jsonl
 *   <tmp>/annotations/<id>.pbtxt
 *
 * `config.ts` reads `KOLU_ANTIGRAVITY_DIR` at import time, so the env is set
 * before the module graph loads — hence the `await import` below.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-antigravity-core-"));
process.env.KOLU_ANTIGRAVITY_DIR = ROOT;

const {
  conversationForDirectory,
  conversationsHeld,
  decodeProtoTextString,
  deriveAntigravityState,
  readStartedAt,
  readTitle,
  resolveAntigravitySessions,
} = await import("./core.ts");

const ID_A = "0a1b2c3d-0000-4000-8000-00000000000a";
const ID_B = "0a1b2c3d-0000-4000-8000-00000000000b";
const CWD = "/work/demo";

// --- Invented transcript lines, one per shape ---

const T0 = "2026-01-01T09:00:00Z";
const user = (text: string, step = 0): string =>
  JSON.stringify({
    step_index: step,
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    status: "DONE",
    created_at: T0,
    content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nlocal time\n</ADDITIONAL_METADATA>`,
  });
const answer = (
  opts: { model?: string; input?: number; cached?: number; text?: string } = {},
): string =>
  JSON.stringify({
    step_index: 1,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-01-01T09:00:02Z",
    model: opts.model ?? "some-model-slug",
    input_tokens: opts.input ?? 1200,
    cache_read_tokens: opts.cached ?? 800,
    output_tokens: 3,
    content: opts.text ?? "hi",
  });
const toolCall = (model = "some-model-slug"): string =>
  JSON.stringify({
    step_index: 3,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    created_at: "2026-01-01T09:00:04Z",
    model,
    input_tokens: 1300,
    cache_read_tokens: 900,
    output_tokens: 40,
    tool_calls: [{ name: "run_command", args: { CommandLine: '"echo hi"' } }],
  });
const generic = (status: string): string =>
  JSON.stringify({
    step_index: 4,
    source: "MODEL",
    type: "GENERIC",
    status,
    created_at: "2026-01-01T09:00:05Z",
    content: "the tool's own words",
    ...(status === "ERROR" ? { error: "declined" } : {}),
  });
const system = JSON.stringify({
  step_index: 8,
  source: "SYSTEM",
  type: "SYSTEM_MESSAGE",
  status: "DONE",
  created_at: "2026-01-01T09:00:06Z",
  content: "a note to the model",
});

function sessionOf(id: string) {
  return {
    id,
    transcriptPath: path.join(
      ROOT,
      "brain",
      id,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    ),
    annotationsPath: path.join(ROOT, "annotations", `${id}.pbtxt`),
  };
}

function writeFile(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

describe("deriveAntigravityState — the last line decides", () => {
  it.each([
    ["a user line (submitted, no answer yet)", [user("say hi")], "thinking"],
    ["a system line after the user's", [user("say hi"), system], "thinking"],
    [
      "a tool-calling answer (menu showing, or the tool running)",
      [user("run it"), toolCall()],
      "tool_use",
    ],
    [
      "a finished tool's result (model answering)",
      [user("run it"), toolCall(), generic("DONE")],
      "thinking",
    ],
    [
      "a background command's result",
      [user("run it"), toolCall(), generic("RUNNING")],
      "thinking",
    ],
    [
      "a system line after a tool's result",
      [toolCall(), generic("DONE"), system],
      "thinking",
    ],
    [
      "an answer without tool_calls (turn finished)",
      [user("say hi"), answer()],
      "waiting",
    ],
  ])("%s", (_moment, lines, state) => {
    expect(deriveAntigravityState(lines)?.state).toBe(state);
  });

  it("keeps the interrupted turn's state: nothing is written on Esc", () => {
    // Esc during an answer leaves the user's line last; during a tool, the
    // tool-calling answer. The fold has nothing else to read.
    expect(deriveAntigravityState([answer(), user("long one")])?.state).toBe(
      "thinking",
    );
    expect(
      deriveAntigravityState([answer(), user("run it"), toolCall()])?.state,
    ).toBe("tool_use");
  });

  it("publishes nothing for a line kind it does not know", () => {
    const unknown = JSON.stringify({ type: "SOMETHING_NEW", status: "DONE" });
    expect(deriveAntigravityState([answer(), unknown])).toBeNull();
  });

  it("publishes nothing for no lines", () => {
    expect(deriveAntigravityState([])).toBeNull();
  });

  it("takes model and context size from the newest model answer", () => {
    const fold = deriveAntigravityState([
      answer({ model: "older-model", input: 10, cached: 0 }),
      user("again"),
      answer({ model: "newer-model", input: 300, cached: 4000 }),
      user("and again"),
    ]);
    expect(fold).toEqual({
      state: "thinking",
      model: "newer-model",
      contextTokens: 4300,
    });
  });

  it("reads model and context size through tool lines", () => {
    const fold = deriveAntigravityState([
      user("run it"),
      toolCall("tool-model"),
      generic("DONE"),
    ]);
    expect(fold).toEqual({
      state: "thinking",
      model: "tool-model",
      contextTokens: 2200,
    });
  });

  it("has no model or context before the first answer", () => {
    expect(deriveAntigravityState([user("say hi")])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: null,
    });
  });
});

describe("which conversation a terminal's agy has", () => {
  const lock = (id: string): string =>
    path.join(ROOT, "presence", `${id}.lock`);

  it("is the presence lock among its open files", () => {
    expect(
      conversationsHeld([
        "/dev/pts/3",
        "socket:[12345]",
        lock(ID_A),
        path.join(ROOT, "conversations", `${ID_A}.db`),
      ]),
    ).toEqual([ID_A]);
  });

  it("is none for a fresh agy holding no lock", () => {
    expect(conversationsHeld(["/dev/pts/3", "pipe:[1]"])).toEqual([]);
  });

  it("ignores a lock-shaped file outside the presence directory", () => {
    expect(
      conversationsHeld([path.join(ROOT, "elsewhere", `${ID_A}.lock`)]),
    ).toEqual([]);
  });

  it("reads this process's real open files on Linux", () => {
    if (process.platform !== "linux") return;
    writeFile(lock(ID_B), "");
    const fd = fs.openSync(lock(ID_B), "r");
    try {
      const found = resolveAntigravitySessions(process.pid, CWD);
      expect(found?.map((s) => s.id)).toEqual([ID_B]);
    } finally {
      fs.closeSync(fd);
    }
  });

  it("falls back to the directory cache when open files are unknown", () => {
    writeFile(
      path.join(ROOT, "cache", "last_conversations.json"),
      JSON.stringify({ [CWD]: ID_A, "/work/other": ID_B }),
    );
    // No pid: the open files cannot be read.
    const found = resolveAntigravitySessions(undefined, CWD);
    expect(found).toEqual([sessionOf(ID_A)]);
  });

  it("gives two agy in one directory the cache's one entry only", () => {
    writeFile(
      path.join(ROOT, "cache", "last_conversations.json"),
      JSON.stringify({ [CWD]: ID_B }),
    );
    expect(conversationForDirectory(CWD)?.map((s) => s.id)).toEqual([ID_B]);
  });

  it("names nothing for a directory the cache does not list", () => {
    writeFile(
      path.join(ROOT, "cache", "last_conversations.json"),
      JSON.stringify({ "/work/other": ID_B }),
    );
    expect(conversationForDirectory(CWD)).toEqual([]);
  });

  it("is null, not empty, when the cache cannot be read", () => {
    writeFile(path.join(ROOT, "cache", "last_conversations.json"), "{not json");
    expect(conversationForDirectory(CWD)).toBeNull();
  });

  it("is empty when agy never wrote the cache", () => {
    fs.rmSync(path.join(ROOT, "cache"), { recursive: true, force: true });
    expect(conversationForDirectory(CWD)).toEqual([]);
  });
});

describe("title", () => {
  const write = (body: string): void =>
    writeFile(sessionOf(ID_A).annotationsPath, body);

  it("is the annotations file's one title line", () => {
    write('title:"Tidy The Notes"');
    expect(readTitle(sessionOf(ID_A))).toBe("Tidy The Notes");
  });

  it("tolerates a trailing newline", () => {
    write('title:"Tidy The Notes"\n');
    expect(readTitle(sessionOf(ID_A))).toBe("Tidy The Notes");
  });

  it("is null when the file is anything but that one line", () => {
    write('title:"One"\nother:"Two"');
    expect(readTitle(sessionOf(ID_A))).toBeNull();
    write('summary:"Not a title"');
    expect(readTitle(sessionOf(ID_A))).toBeNull();
  });

  it("is null when the file is absent", () => {
    expect(readTitle(sessionOf(ID_B))).toBeNull();
  });

  it("decodes protobuf text escapes", () => {
    expect(decodeProtoTextString('say \\"hi\\"')).toBe('say "hi"');
    expect(decodeProtoTextString("caf\\303\\251")).toBe("café");
    expect(decodeProtoTextString("caf\\xc3\\xa9")).toBe("café");
    expect(decodeProtoTextString("café")).toBe("café");
    expect(decodeProtoTextString("bad \\q escape")).toBeNull();
    expect(decodeProtoTextString("\\377")).toBeNull(); // not UTF-8
  });
});

describe("start time", () => {
  it("is the first line's created_at", () => {
    writeFile(sessionOf(ID_A).transcriptPath, `${user("hi")}\n${answer()}\n`);
    expect(readStartedAt(sessionOf(ID_A))).toBe(Date.parse(T0));
  });

  it("is null before the transcript exists", () => {
    expect(readStartedAt(sessionOf(ID_B))).toBeNull();
  });
});
