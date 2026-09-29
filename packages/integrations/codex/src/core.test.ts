import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSessionsByDirectory } from "./core.ts";

const config = vi.hoisted(() => ({ CODEX_DB_PATH: "" }));
vi.mock("./config.ts", () => config);

describe("findSessionsByDirectory", () => {
  let directory: string;
  let db: DatabaseSync;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "codex-threads-"));
    config.CODEX_DB_PATH = join(directory, "state_5.sqlite");
    db = new DatabaseSync(config.CODEX_DB_PATH);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT, source TEXT,
        archived INTEGER, updated_at_ms INTEGER, title TEXT, model TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function insert(
    id: string,
    source: string,
    cwd = "/project",
    archived = 0,
    updated = 1,
  ) {
    db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)").run(
      id,
      `/rollouts/${id}.jsonl`,
      cwd,
      source,
      archived,
      updated,
    );
  }

  it.each([
    "cli",
    "vscode",
  ])("returns %s threads in the terminal's directory", (source) => {
    insert("session", source);
    expect(findSessionsByDirectory("/project")).toEqual([
      {
        id: "session",
        rolloutPath: "/rollouts/session.jsonl",
        startedAt: null,
      },
    ]);
  });

  it.each([
    "exec",
    '{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}',
    '{"subagent":{"other":"guardian"}}',
  ])("excludes %s threads", (source) => {
    insert("excluded", source);
    expect(findSessionsByDirectory("/project")).toEqual([]);
  });

  it("keeps directory and archive filters and most-recent-first ordering", () => {
    insert("older", "cli", "/project", 0, 1);
    insert("newer", "vscode", "/project", 0, 2);
    insert("elsewhere", "vscode", "/other", 0, 3);
    insert("archived", "vscode", "/project", 1, 4);
    expect(
      findSessionsByDirectory("/project")?.map((session) => session.id),
    ).toEqual(["newer", "older"]);
  });
});
