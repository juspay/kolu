import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Point pi home at a temp dir BEFORE importing modules that capture paths.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-pi-test-"));
process.env.KOLU_PI_DIR = tmpHome;

const {
  derivePiState,
  findSessionsByDirectory,
  parseSessionFileName,
  piHomePresent,
  sessionDirFor,
  sessionDirNameFor,
  subscribeSessionsTree,
} = await import("./core.ts");

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("sessionDirNameFor", () => {
  it("replaces / with - and wraps in --", () => {
    expect(sessionDirNameFor("/home/u/proj")).toBe("--home-u-proj--");
  });

  it("keeps dots literal (unlike claude's key)", () => {
    expect(sessionDirNameFor("/w/.worktrees/x")).toBe("--w-.worktrees-x--");
  });
});

describe("parseSessionFileName", () => {
  it("parses timestamp + id", () => {
    const parsed = parseSessionFileName(
      "2026-08-23T19-48-21-451Z_01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8.jsonl",
    );
    expect(parsed?.id).toBe("01a0302a-b94b-7b18-a3c3-b3f83dfe6fe8");
    expect(parsed?.startedAt).toBe(Date.parse("2026-08-23T19:48:21.451Z"));
  });

  it("rejects non-session names", () => {
    expect(parseSessionFileName("session.jsonl")).toBeNull();
    expect(parseSessionFileName("README")).toBeNull();
    expect(parseSessionFileName("")).toBeNull();
  });
});

describe("findSessionsByDirectory", () => {
  const cwd = "/some/project";
  const file = (name: string) => path.join(sessionDirFor(cwd), name);

  it("returns [] when pi has never run here (ENOENT is absence, not error)", () => {
    expect(findSessionsByDirectory("/never/seen")).toEqual([]);
  });

  it("lists matching sessions newest-first and skips non-session files", () => {
    const dir = sessionDirFor(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file(
        "2026-01-01T00-00-00-000Z_aaaaaaaa-0000-0000-0000-00000000000a.jsonl",
      ),
      "",
    );
    const newest =
      "2026-02-01T00-00-00-000Z_bbbbbbbb-0000-0000-0000-00000000000b.jsonl";
    fs.writeFileSync(file(newest), "");
    fs.writeFileSync(file("prompt_history.jsonl"), "");
    // Force mtimes: newest file must also be newest by mtime.
    const t = new Date();
    fs.utimesSync(file(newest), new Date(t.getTime() - 1000), t);
    const old =
      "2026-01-01T00-00-00-000Z_aaaaaaaa-0000-0000-0000-00000000000a.jsonl";
    fs.utimesSync(
      file(old),
      new Date(t.getTime() - 2000),
      new Date(t.getTime() - 1000),
    );

    const sessions = findSessionsByDirectory(cwd);
    expect(sessions?.map((s) => s.id)).toEqual([
      "bbbbbbbb-0000-0000-0000-00000000000b",
      "aaaaaaaa-0000-0000-0000-00000000000a",
    ]);
    expect(sessions?.[0]?.transcriptPath.endsWith(newest)).toBe(true);
    expect(sessions?.[0]?.startedAt).toBe(Date.parse("2026-02-01T00:00:00Z"));
  });

  it("returns null when the dir exists but cannot be read", () => {
    if (process.platform === "win32") return;
    const badCwd = "/locked/project";
    const dir = sessionDirFor(badCwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0);
    try {
      expect(findSessionsByDirectory(badCwd)).toBeNull();
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
});

describe("piHomePresent", () => {
  it("tracks the sessions root's existence", () => {
    const root = path.join(tmpHome, "sessions");
    fs.rmSync(root, { recursive: true, force: true });
    expect(piHomePresent()).toBe(false);
    fs.mkdirSync(root, { recursive: true });
    expect(piHomePresent()).toBe(true);
  });
});

// --- subscribeSessionsTree (externalChanges wake source) ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("subscribeSessionsTree", () => {
  it("fires when a per-cwd dir and its first session file appear after install", async () => {
    const root = path.join(tmpHome, "sessions");
    fs.rmSync(root, { recursive: true, force: true });
    let fired = 0;
    const stop = subscribeSessionsTree(
      () => {
        fired++;
      },
      () => {},
    );
    try {
      // The per-cwd dir AND its file are created after install — the root
      // watch must arm the child, and the file create must fan out.
      const dir = sessionDirFor("/late/project");
      fs.mkdirSync(dir, { recursive: true });
      await sleep(300);
      const before = fired;
      fs.writeFileSync(
        path.join(
          dir,
          "2026-08-23T10-00-00-000Z_11111111-2222-4333-8444-555555555555.jsonl",
        ),
        "{}",
      );
      await sleep(300);
      expect(fired).toBeGreaterThan(before);
    } finally {
      stop();
    }
  });

  it("keeps firing when a second session lands in an already-watched dir", async () => {
    const dir = sessionDirFor("/watched/project");
    fs.mkdirSync(dir, { recursive: true });
    let fired = 0;
    const stop = subscribeSessionsTree(
      () => {
        fired++;
      },
      () => {},
    );
    try {
      await sleep(300); // let the child dir watch arm (attach kick fires once)
      const before = fired;
      fs.writeFileSync(
        path.join(
          dir,
          "2026-08-23T11-00-00-000Z_66666666-7777-4888-8999-000000000000.jsonl",
        ),
        "{}",
      );
      await sleep(300);
      expect(fired).toBeGreaterThan(before);
    } finally {
      stop();
    }
  });
});

// --- derivePiState (pure fold) ---

const header =
  '{"type":"session","version":3,"id":"s","timestamp":"2026-08-23T19:48:21.451Z","cwd":"/x"}';
const user = (text = "hi") =>
  `{"type":"message","id":"u","parentId":null,"timestamp":"t","message":{"role":"user","content":[{"type":"text","text":${JSON.stringify(text)}}]}}`;
const assistant = (stopReason: string, model = "m", usage?: object) =>
  `{"type":"message","id":"a","parentId":"u","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"model":"${model}","usage":${JSON.stringify(usage ?? { input: 1000, output: 10, cacheRead: 2000, cacheWrite: 100 })},"stopReason":"${stopReason}"}}`;
const toolResult =
  '{"type":"message","id":"r","parentId":"a","timestamp":"t","message":{"role":"toolResult","toolCallId":"bash:1","toolName":"bash","content":[{"type":"text","text":"out"}],"isError":false}}';
const modelChange = (modelId = "new-model") =>
  `{"type":"model_change","id":"mc","parentId":null,"timestamp":"t","provider":"p","modelId":"${modelId}"}`;
const sessionInfo = (name: string) =>
  `{"type":"session_info","id":"si","parentId":"u","timestamp":"t","name":${JSON.stringify(name)}}`;

describe("derivePiState", () => {
  it("assistant stopReason toolUse → tool_use", () => {
    expect(derivePiState([header, user(), assistant("toolUse")])?.state).toBe(
      "tool_use",
    );
  });

  it("assistant turn-ending reasons → waiting", () => {
    for (const reason of ["stop", "length", "error", "aborted"]) {
      expect(derivePiState([header, user(), assistant(reason)])?.state).toBe(
        "waiting",
      );
    }
  });

  it("trailing user prompt → thinking", () => {
    expect(derivePiState([header, assistant("stop"), user()])?.state).toBe(
      "thinking",
    );
  });

  it("trailing toolResult → thinking (model about to be re-invoked)", () => {
    const r = derivePiState([header, user(), assistant("toolUse"), toolResult]);
    expect(r?.state).toBe("thinking");
    // Model comes from the SAME entry the state derived from (claude's rule):
    // a toolResult tail carries no model, so the badge briefly none — never
    // a stale earlier value pinned across the re-invoke.
    expect(r?.model).toBeNull();
  });

  it("walks past interactive artifacts to the genuine prior turn", () => {
    const bashExecution =
      '{"type":"message","id":"b","parentId":"a","timestamp":"t","message":{"role":"bashExecution","command":"ls","output":"x","exitCode":0,"cancelled":false,"truncated":false}}';
    const compaction =
      '{"type":"compaction","id":"c","parentId":"a","timestamp":"t","summary":"…","tokensBefore":50000}';
    expect(
      derivePiState([
        header,
        user(),
        assistant("stop"),
        bashExecution,
        compaction,
      ])?.state,
    ).toBe("waiting");
  });

  it("reports contextTokens as input+cacheRead+cacheWrite from the newest assistant usage", () => {
    const r = derivePiState([
      header,
      user(),
      assistant("stop", "m", { input: 100, cacheRead: 20, cacheWrite: 3 }),
      user(),
    ]);
    expect(r?.contextTokens).toBe(123);
  });

  it("a zero-sum usage is the answer for its turn (0), not a borrow from an older turn", () => {
    const r = derivePiState([
      header,
      user(),
      assistant("stop", "m", { input: 5 }),
      user(),
      assistant("error", "m", { input: 0, cacheRead: 0, cacheWrite: 0 }),
    ]);
    expect(r?.contextTokens).toBe(0);
    expect(r?.state).toBe("waiting");
  });

  it("a prefix of only model_change entries publishes NOTHING (fresh pi at an idle prompt is not working — repo-verified: pi writes session → thinking_level_change → model_change at startup)", () => {
    expect(
      derivePiState([
        header,
        `{"type":"thinking_level_change","id":"t1","parentId":null,"timestamp":"t","thinkingLevel":"off"}`,
        modelChange("gpt-5"),
      ]),
    ).toBeNull();
    expect(derivePiState([header, modelChange("gpt-5")])).toBeNull();
  });

  it("a model_change after a completed turn updates the model but keeps the turn state (idle /model cycling is not work in flight)", () => {
    const r = derivePiState([
      header,
      user(),
      assistant("stop", "old-model", { input: 10 }),
      modelChange("new-model"),
    ]);
    expect(r?.state).toBe("waiting");
    expect(r?.model).toBe("new-model");
    expect(r?.contextTokens).toBe(10);
  });

  it("summary comes from the newest session_info entry", () => {
    const r = derivePiState([
      header,
      sessionInfo("older"),
      user(),
      sessionInfo("the name"),
      assistant("stop"),
    ]);
    expect(r?.summary).toBe("the name");
    expect(r?.state).toBe("waiting");
  });

  it("returns null when the tail carries no turn signal at all", () => {
    expect(derivePiState([header])).toBeNull();
    expect(derivePiState([])).toBeNull();
  });
});
