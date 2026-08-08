/**
 * The #1658 acceptance cases, pinned: boot with an existing state file → backup
 * created; boot again unchanged → no new backup (byte-dedupe); ring past N →
 * oldest pruned; backup-write failure → the call answers `failed` and throws
 * nothing (fail-soft — the one sanctioned deviation from fail-fast, see the
 * module doc). Plus the restore side's fail-FAST: a wire-crossing file name
 * that is not a ring member's is refused (path traversal unspellable), and a
 * restore whose undo snapshot fails is REFUSED rather than silently
 * irreversible.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openStateBackupRing,
  STATE_BACKUP_RING_SIZE,
  type StateBackupRing,
} from "./stateBackup.ts";

let dir: string;
let configPath: string;
let ring: StateBackupRing;
const logged: { level: "debug" | "info" | "warn" | "error"; msg: string }[] =
  [];
const log = {
  debug: (_obj: object, msg: string) => logged.push({ level: "debug", msg }),
  info: (_obj: object, msg: string) => logged.push({ level: "info", msg }),
  warn: (_obj: object, msg: string) => logged.push({ level: "warn", msg }),
  error: (_obj: object, msg: string) => logged.push({ level: "error", msg }),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "state-backup-"));
  configPath = join(dir, "config.json");
  ring = openStateBackupRing(configPath, log);
  logged.length = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("snapshot", () => {
  it("skips a fresh install (no state file, no ring dir)", () => {
    expect(ring.snapshot()).toEqual({ kind: "no-state-file" });
    expect(ring.list()).toEqual([]);
  });

  it("copies an existing state file into the ring, byte-identical", () => {
    writeFileSync(configPath, '{"session":{"terminals":[1]}}');
    const outcome = ring.snapshot();
    expect(outcome.kind).toBe("created");
    const [entry] = ring.list();
    expect(entry).toBeDefined();
    expect(readFileSync(join(ring.dir, entry!.file), "utf8")).toBe(
      '{"session":{"terminals":[1]}}',
    );
  });

  it("dedupes an unchanged file — a quick restart churns no copy", () => {
    writeFileSync(configPath, '{"a":1}');
    expect(ring.snapshot().kind).toBe("created");
    expect(ring.snapshot()).toEqual({ kind: "unchanged" });
    expect(ring.list()).toHaveLength(1);
  });

  it("snapshots again once the content changes, newest first", () => {
    writeFileSync(configPath, '{"a":1}');
    ring.snapshot();
    writeFileSync(configPath, '{"a":2}');
    const outcome = ring.snapshot();
    expect(outcome.kind).toBe("created");
    const entries = ring.list();
    expect(entries).toHaveLength(2);
    expect(readFileSync(join(ring.dir, entries[0]!.file), "utf8")).toBe(
      '{"a":2}',
    );
  });

  it(`prunes the ring to the newest ${STATE_BACKUP_RING_SIZE}`, () => {
    for (let i = 0; i < STATE_BACKUP_RING_SIZE + 3; i += 1) {
      writeFileSync(configPath, `{"i":${i}}`);
      expect(ring.snapshot().kind).toBe("created");
    }
    const entries = ring.list();
    expect(entries).toHaveLength(STATE_BACKUP_RING_SIZE);
    // The newest survives; the oldest three were pruned.
    expect(readFileSync(join(ring.dir, entries[0]!.file), "utf8")).toBe(
      `{"i":${STATE_BACKUP_RING_SIZE + 2}}`,
    );
  });

  it("keeps the ring owner-only, mirroring the store it copies", () => {
    writeFileSync(configPath, '{"a":1}', { mode: 0o600 });
    const outcome = ring.snapshot();
    if (outcome.kind !== "created") throw new Error("expected a snapshot");
    expect(statSync(ring.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(ring.dir, outcome.file)).mode & 0o777).toBe(0o600);
  });

  it("fail-soft: an unwritable ring dir logs and answers failed, never throws", () => {
    writeFileSync(configPath, '{"a":1}');
    // Occupy the ring dir's name with a FILE so mkdir/copy must fail.
    writeFileSync(ring.dir, "not a directory");
    expect(ring.snapshot()).toEqual({ kind: "failed" });
    expect(logged.some((l) => l.level === "error")).toBe(true);
  });
});

describe("the ring's file-name grammar", () => {
  it("accepts every name the writer produces, on both the plain and the bumped arm", () => {
    writeFileSync(configPath, '{"a":1}');
    const first = ring.snapshot();
    if (first.kind !== "created") throw new Error("expected a snapshot");
    // A same-millisecond sibling: the writer bumps rather than overwriting, and
    // the reader must accept the bumped name too.
    writeFileSync(join(ring.dir, first.file.replace(".json", "-2.json")), "{}");
    for (const file of ring.list().map((e) => e.file)) {
      expect(() => ring.pathOf(file)).not.toThrow();
    }
    expect(ring.list()).toHaveLength(2);
  });

  it("refuses a name the writer could never mint", () => {
    // Syntactically `[0-9TZ-]+`, but no instant — the old regex accepted it.
    expect(() => ring.pathOf("config.--.json")).toThrow(
      /not a state-backup file name/,
    );
    expect(() => ring.pathOf("config.2026-13-45T99-99-99-999Z.json")).toThrow(
      /not a state-backup file name/,
    );
  });

  it("keeps two stores in one directory on two independent rings", () => {
    const sessionPath = join(dir, "session.json");
    const sessionRing = openStateBackupRing(sessionPath, log);
    writeFileSync(configPath, '{"which":"config"}');
    writeFileSync(sessionPath, '{"which":"session"}');
    const config = ring.snapshot();
    const session = sessionRing.snapshot();
    if (config.kind !== "created" || session.kind !== "created") {
      throw new Error("expected both snapshots");
    }
    expect(config.file.startsWith("config.")).toBe(true);
    expect(session.file.startsWith("session.")).toBe(true);
    expect(ring.list().map((e) => e.file)).toEqual([config.file]);
    expect(sessionRing.list().map((e) => e.file)).toEqual([session.file]);
    // Neither ring can be handed the other's member.
    expect(() => ring.read(session.file)).toThrow(
      /not a state-backup file name/,
    );
  });

  it("dates a member by its NAME, not by a rewritable mtime", () => {
    writeFileSync(configPath, '{"a":1}');
    const outcome = ring.snapshot();
    if (outcome.kind !== "created") throw new Error("expected a snapshot");
    const before = ring.list()[0]!.savedAtMs;
    // `touch` the copy a decade forward — the row's age must not move.
    const decade = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    utimesSync(join(ring.dir, outcome.file), decade, decade);
    expect(ring.list()[0]!.savedAtMs).toBe(before);
  });
});

describe("read", () => {
  it("round-trips a snapshot's JSON", () => {
    writeFileSync(configPath, '{"session":null,"n":42}');
    const outcome = ring.snapshot();
    if (outcome.kind !== "created") throw new Error("expected a snapshot");
    expect(ring.read(outcome.file)).toEqual({ session: null, n: 42 });
  });

  it("refuses a non-ring file name — traversal is unspellable", () => {
    expect(() => ring.read("../config.json")).toThrow(
      /not a state-backup file name/,
    );
    expect(() => ring.read("pwn.json")).toThrow(/not a state-backup file name/);
  });

  it("throws on a missing snapshot (fail-fast on the restore side)", () => {
    expect(() => ring.read("config.2026-01-01T00-00-00-000Z.json")).toThrow();
  });
});

describe("listWith", () => {
  it("summarizes what parsed and marks what did not, without collapsing", () => {
    writeFileSync(configPath, '{"n":1}');
    const good = ring.snapshot();
    if (good.kind !== "created") throw new Error("expected a snapshot");
    writeFileSync(
      join(ring.dir, "config.1999-01-01T00-00-00-000Z.json"),
      "{no",
    );
    const rows = ring.listWith(
      (raw) => `n=${(raw as { n: number }).n}`,
      "unreadable",
    );
    expect(rows.find((r) => r.file === good.file)?.summary).toBe("n=1");
    expect(
      rows.find((r) => r.file === "config.1999-01-01T00-00-00-000Z.json")
        ?.summary,
    ).toBe("unreadable");
    expect(logged.some((l) => l.level === "error")).toBe(true);
  });
});

describe("restore", () => {
  it("pushes the CURRENT file into the ring before applying — the undo is the ring's, not the caller's", () => {
    writeFileSync(configPath, '{"gen":1}');
    const first = ring.snapshot();
    if (first.kind !== "created") throw new Error("expected a snapshot");
    writeFileSync(configPath, '{"gen":2}');
    const applied = ring.restore(first.file, (raw) => raw);
    expect(applied).toEqual({ gen: 1 });
    // Two members now: the restored-from snapshot and the pre-restore undo.
    const files = ring
      .list()
      .map((e) => readFileSync(join(ring.dir, e.file), "utf8"));
    expect(files).toContain('{"gen":1}');
    expect(files).toContain('{"gen":2}');
  });

  it("refuses when the undo snapshot fails — an unundoable restore is not offered", () => {
    writeFileSync(configPath, '{"gen":1}');
    const first = ring.snapshot();
    if (first.kind !== "created") throw new Error("expected a snapshot");
    writeFileSync(configPath, '{"gen":2}');
    // Break the ring's NEWEST member (a directory where a snapshot should be),
    // so the dedupe read throws and the undo snapshot answers `failed` — while
    // the member being restored FROM still reads fine.
    mkdirSync(join(ring.dir, "config.2999-01-01T00-00-00-000Z.json"));
    let applied = false;
    expect(() =>
      ring.restore(first.file, () => {
        applied = true;
      }),
    ).toThrow(/would not be undoable/);
    expect(applied).toBe(false);
  });
});
