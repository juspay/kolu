/**
 * Xyne core unit tests — fixtures mimic the real on-disk layout:
 *
 *   <tmp>/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
 *   <tmp>/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>_summary.json
 *
 * `config.ts` resolves `KOLU_XYNE_DIR` at import time, so the env must be
 * set before the module graph loads — hence the `await import` below.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const XYNE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-xyne-core-"));
// `config.ts` evaluates `KOLU_XYNE_DIR` at import time — set it BEFORE the
// module graph loads (the `beforeAll` would run after the import below).
process.env.KOLU_XYNE_DIR = XYNE_TMP;
void beforeAll; // keep the import used (no hook needed; top-level awaits serialise)

const {
  deriveXyneInfo,
  encodeCwd,
  readLatestModel,
  resolveXyneSession,
  resolveXyneSessions,
  xyneSessionStartedAt,
} = await import("./core.ts");

const CWD = "/home/u/proj";
const ID_A = "019fca61-be8e-75b0-b72f-b68984e0d3c0";
const ID_B = "027fca61-be8e-75b0-b72f-b68984e0d3c0";
const ID_BARE = "00000000-0000-7000-8000-000000000099";

/** Filename timestamp (`2026-08-04T01-27-11-247Z`) → ISO string. */
function isoOf(tsName: string): string {
  return tsName.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z",
  );
}

function writeSession(opts: {
  id: string;
  tsName: string;
  cwd: string;
  model?: string;
  title?: string;
}): { transcriptPath: string; summaryPath: string; dir: string } {
  const dir = path.join(XYNE_TMP, "agent", "sessions", encodeCwd(opts.cwd));
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, `${opts.tsName}_${opts.id}.jsonl`);
  const lines: object[] = [
    {
      type: "session",
      version: 3,
      id: opts.id,
      timestamp: isoOf(opts.tsName),
      cwd: opts.cwd,
    },
  ];
  if (opts.model !== undefined) {
    const slash = opts.model.indexOf("/");
    lines.push({
      type: "model_change",
      id: "6b4cd891",
      parentId: null,
      timestamp: isoOf(opts.tsName),
      provider: opts.model.slice(0, slash),
      modelId: opts.model.slice(slash + 1),
    });
  }
  lines.push({
    type: "message",
    id: "abc",
    parentId: null,
    timestamp: isoOf(opts.tsName),
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
  });
  fs.writeFileSync(
    transcriptPath,
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
  const summaryPath = transcriptPath.replace(/\.jsonl$/, "_summary.json");
  if (opts.title !== undefined) {
    fs.writeFileSync(summaryPath, JSON.stringify({ title: opts.title }));
  }
  return { transcriptPath, summaryPath, dir };
}

describe("encodeCwd", () => {
  it("replaces every non-alphanumeric, non-hyphen char with -", () => {
    expect(encodeCwd("/home/a/b")).toBe("-home-a-b");
    expect(encodeCwd("/x/.: y")).toBe("-x----y");
  });
});

describe("resolveXyneSession", () => {
  it("returns null when the cwd's dir does not exist", () => {
    expect(resolveXyneSession("/never/existed")).toBeNull();
  });

  it("returns null when the dir holds only sidecars", () => {
    const { dir, transcriptPath } = writeSession({
      id: ID_A,
      tsName: "2026-08-04T01-27-11-247Z",
      cwd: "/only/sidecars",
      title: "t",
    });
    fs.rmSync(transcriptPath);
    expect(fs.readdirSync(dir).length).toBeGreaterThan(0);
    expect(resolveXyneSession("/only/sidecars")).toBeNull();
  });

  it("picks the newest transcript for the cwd (filename = time order)", () => {
    writeSession({ id: ID_A, tsName: "2026-08-04T01-27-11-247Z", cwd: CWD });
    writeSession({ id: ID_B, tsName: "2026-08-04T02-00-00-000Z", cwd: CWD });
    expect(resolveXyneSession(CWD)?.id).toBe(ID_B);
  });

  it("ranks by parsed timestamp, not filename string order", () => {
    // Regression for the lens-debate bytewise-`<` finding: an id whose
    // leading hex sorts HIGH must not outrank a genuinely NEWER timestamp
    // whose leading hex sorts low.
    const OLDER_HIGH_ID = "ffffffff-ffff-7fff-bfff-ffffffffffff";
    const NEWER_LOW_ID = "00000000-0000-7000-8000-0000000000ff";
    writeSession({
      id: OLDER_HIGH_ID,
      tsName: "2026-08-04T01-00-00-000Z",
      cwd: "/rank",
    });
    writeSession({
      id: NEWER_LOW_ID,
      tsName: "2026-08-04T03-00-00-000Z",
      cwd: "/rank",
    });
    expect(resolveXyneSession("/rank")?.id).toBe(NEWER_LOW_ID);
  });

  it("resolves per-cwd independently (a newer session elsewhere doesn't bleed)", () => {
    // Regression for the lens-debate F2 finding: resolution is per-cwd, so
    // a newer transcript in a DIFFERENT cwd must not be picked.
    writeSession({
      id: ID_A,
      tsName: "2026-08-04T01-00-00-000Z",
      cwd: "/mine",
    });
    writeSession({
      id: ID_B,
      tsName: "2026-08-04T03-00-00-000Z",
      cwd: "/elsewhere",
    });
    expect(resolveXyneSession("/mine")?.id).toBe(ID_A);
  });
});

describe("deriveXyneInfo", () => {
  it("reads state=waiting, header startedAt, tail model, and sidecar title", () => {
    writeSession({
      id: ID_A,
      tsName: "2026-08-04T01-27-11-247Z",
      cwd: "/full",
      model: "juspay/kimi-k3",
      title: "How do I install Nix?",
    });
    const s = resolveXyneSession("/full");
    expect(s?.id).toBe(ID_A);
    const info = deriveXyneInfo(s!);
    expect(info).toEqual({
      kind: "xyne",
      state: "waiting",
      sessionId: ID_A,
      model: "juspay/kimi-k3",
      summary: "How do I install Nix?",
      taskProgress: null,
      contextTokens: null,
      startedAt: Date.parse(isoOf("2026-08-04T01-27-11-247Z")),
    });
  });

  it("honest nulls when summary sidecar and model_change are absent", () => {
    writeSession({
      id: ID_BARE,
      tsName: "2026-08-01T00-00-00-000Z",
      cwd: "/plain",
    });
    const s = resolveXyneSession("/plain");
    expect(s?.id).toBe(ID_BARE);
    const info = deriveXyneInfo(s!);
    expect(info?.model).toBeNull();
    expect(info?.summary).toBeNull();
    expect(info?.state).toBe("waiting");
    expect(info?.startedAt).toBe(Date.parse(isoOf("2026-08-01T00-00-00-000Z")));
  });

  it("returns null when the transcript's header id disagrees with the filename", () => {
    const { transcriptPath, dir } = writeSession({
      id: ID_A,
      tsName: "2026-08-04T05-00-00-000Z",
      cwd: "/mismatch",
    });
    // Rewrite the header with a different id — a shape violation the derive
    // must refuse rather than lie about.
    const rest = fs.readFileSync(transcriptPath, "utf8").split("\n").slice(1);
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: ID_B,
        timestamp: isoOf("2026-08-04T05-00-00-000Z"),
        cwd: "/mismatch",
      }) +
        "\n" +
        rest.join("\n"),
    );
    void dir;
    const s = resolveXyneSession("/mismatch");
    expect(s?.id).toBe(ID_A);
    expect(deriveXyneInfo(s!)).toBeNull();
  });
});

describe("readLatestModel", () => {
  it("returns the NEWEST model_change in the tail", () => {
    const { transcriptPath } = writeSession({
      id: ID_A,
      tsName: "2026-08-04T03-00-00-000Z",
      cwd: "/switched",
      model: "juspay/kimi-k3",
    });
    fs.appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "model_change",
        id: "later",
        parentId: null,
        timestamp: "2026-08-04T03:05:00.000Z",
        provider: "openai",
        modelId: "gpt-5",
      })}\n`,
    );
    expect(readLatestModel(transcriptPath)).toBe("openai/gpt-5");
  });

  it("returns null when no model_change exists", () => {
    const { transcriptPath } = writeSession({
      id: ID_A,
      tsName: "2026-08-04T04-00-00-000Z",
      cwd: "/nomodel",
    });
    expect(readLatestModel(transcriptPath)).toBeNull();
  });
});

describe("resolveXyneSessions (the adapter's plural contract)", () => {
  it("returns an EMPTY list when the cwd's dir does not exist", () => {
    expect(resolveXyneSessions("/never/existed-ccb96261")).toEqual([]);
  });

  it("returns an EMPTY list when the dir holds only sidecars", () => {
    const { dir, transcriptPath } = writeSession({
      id: ID_A,
      tsName: "2026-08-04T01-27-11-247Z",
      cwd: "/only/sidecars-plural",
      title: "t",
    });
    fs.rmSync(transcriptPath);
    expect(fs.readdirSync(dir).length).toBeGreaterThan(0);
    expect(resolveXyneSessions("/only/sidecars-plural")).toEqual([]);
  });

  it("yields exactly one candidate wrapped in a list", () => {
    writeSession({
      id: ID_A,
      tsName: "2026-08-04T01-27-11-247Z",
      cwd: "/plural/match",
    });
    const out = resolveXyneSessions("/plural/match");
    expect(out).toHaveLength(1);
    expect(out?.[0]?.id).toBe(ID_A);
  });
});

describe("xyneSessionStartedAt", () => {
  it("parses the filename timestamp prefix into epoch-ms", () => {
    const session = resolveXyneSession("/starter");
    const { transcriptPath } = writeSession({
      id: ID_A,
      tsName: "2026-08-04T01-27-11-247Z",
      cwd: "/starter",
    });
    void session;
    expect(
      xyneSessionStartedAt({
        id: ID_A,
        cwd: "/starter",
        transcriptPath,
        summaryPath: "",
      }),
    ).toBe(Date.parse("2026-08-04T01:27:11.247Z"));
  });

  it("returns null for a name that doesn't carry the timestamp", () => {
    expect(
      xyneSessionStartedAt({
        id: ID_A,
        cwd: "/x",
        transcriptPath: "/anywhere/whatever.jsonl",
        summaryPath: "",
      }),
    ).toBeNull();
  });
});
