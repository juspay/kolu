/**
 * Lock 1 covering tests (juspay/kolu#1334). Pure fs + env — it never forks a real
 * DAEMON or PTY, so it needs no daemon-test gate. Every case runs under a fake $HOME
 * + $XDG_RUNTIME_DIR temp so nothing real is touched.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  persistentRoleMarkerPath,
  readPersistentRoleResult,
  resolveBoundStateRoot,
  sameRootIdentity,
  StateRootIsolationError,
  writePersistentProductionMarker,
} from "./role.ts";

/** The default padi state root under the sandboxed $HOME. */
function defaultRoot(): string {
  return join(process.env.HOME as string, ".local", "state", "padi");
}

let sandbox: string;
const saved = { ...process.env };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "role-test-"));
  process.env.HOME = join(sandbox, "home");
  process.env.XDG_RUNTIME_DIR = join(sandbox, "xdg");
  mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
  mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  delete process.env.KOLU_ROLE;
  delete process.env.KOLU_PADI_STATE_DIR;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(sandbox, { recursive: true, force: true });
});

describe("Lock 1 — resolveBoundStateRoot", () => {
  test("a non-production binder with no override is REFUSED (bare-launch hole)", () => {
    expect(() => resolveBoundStateRoot()).toThrow(StateRootIsolationError);
  });

  test("production with no override binds its default root", () => {
    process.env.KOLU_ROLE = "production";
    expect(resolveBoundStateRoot()).toBe(
      join(process.env.HOME!, ".local", "state", "padi"),
    );
  });

  test("an explicit isolated override is honored for dev", () => {
    const dev = join(sandbox, "dev-root");
    expect(resolveBoundStateRoot(dev)).toBe(dev);
  });

  test("a non-production binder pointing AT the default root is refused (A2)", () => {
    const def = join(process.env.HOME!, ".local", "state", "padi");
    expect(() => resolveBoundStateRoot(def)).toThrow(StateRootIsolationError);
  });

  test("a non-production binder at a persistently-marked relocated prod root is refused (A3c)", () => {
    const relocated = join(sandbox, "relocated-prod");
    mkdirSync(relocated, { recursive: true });
    writePersistentProductionMarker(relocated);
    expect(() => resolveBoundStateRoot(relocated)).toThrow(
      StateRootIsolationError,
    );
  });

  test("production may bind a marked relocated root", () => {
    process.env.KOLU_ROLE = "production";
    const relocated = join(sandbox, "relocated-prod");
    mkdirSync(relocated, { recursive: true });
    writePersistentProductionMarker(relocated);
    expect(resolveBoundStateRoot(relocated)).toBe(relocated);
    expect(readPersistentRoleResult(relocated)).toEqual({
      kind: "role",
      role: "production",
    });
  });
});

describe("Lock 1 — canonical (realpath) root identity (F3) + unreadable marker (F7)", () => {
  test("a SYMLINK alias to the default root is refused (F3 — lexical bypass closed)", () => {
    const def = defaultRoot();
    mkdirSync(def, { recursive: true, mode: 0o700 });
    // `alias` is lexically distinct from `def` but realpath-resolves to it.
    const alias = join(sandbox, "alias-to-default");
    symlinkSync(def, alias);
    expect(sameRootIdentity(alias, def)).toBe(true);
    expect(() => resolveBoundStateRoot(alias)).toThrow(StateRootIsolationError);
  });

  test("a NEW dev root that does not exist yet is honored (ENOENT → lexical fallback)", () => {
    // A genuinely-new isolated dev root has no inode to realpath — it must NOT be
    // conflated with the default; the lexical fallback lets it bind.
    const fresh = join(sandbox, "brand-new-dev-root");
    expect(resolveBoundStateRoot(fresh)).toBe(fresh);
  });

  test("an override whose absent leaf sits under a SYMLINKED parent of the default is refused (F3 deepest-ancestor)", () => {
    // BOTH the default `padi` leaf and the override are absent, but the override's parent
    // is a symlink to the default's parent (~/.local/state). A leaf-only realpath ENOENTs
    // on both → lexical "differ" → the dev binder is wrongly let onto the real default
    // production root. Canonicalizing the deepest EXISTING ancestor (the symlinked parent)
    // resolves `<alias>/padi` → the default root and refuses.
    const def = defaultRoot();
    const defParent = dirname(def); // ~/.local/state
    mkdirSync(defParent, { recursive: true, mode: 0o700 });
    const aliasParent = join(sandbox, "alias-state");
    symlinkSync(defParent, aliasParent);
    const aliasedDefault = join(aliasParent, basename(def)); // <alias-state>/padi (absent)
    expect(sameRootIdentity(aliasedDefault, def)).toBe(true);
    expect(() => resolveBoundStateRoot(aliasedDefault)).toThrow(
      StateRootIsolationError,
    );
  });

  test("an explicit root with an EMPTY persistent marker is refused (F7 — empty is unreadable)", () => {
    // A legacy truncated / failed-write / manually-emptied marker on a RELOCATED prod
    // root: present but empty. It must NOT read as honest absence ("unmarked → dev may
    // bind"); an empty marker is `unreadable`, so the bind fails closed.
    const root = join(sandbox, "empty-marker-root");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(persistentRoleMarkerPath(root), "");
    expect(readPersistentRoleResult(root).kind).toBe("unreadable");
    expect(() => resolveBoundStateRoot(root)).toThrow(StateRootIsolationError);
  });

  test("an explicit root with an UNREADABLE persistent marker is refused (F7 fail-closed)", () => {
    const root = join(sandbox, "corrupt-marker-root");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // A marker we cannot trust: a directory where the one-line file is expected
    // (readFileSync → EISDIR, a non-ENOENT error → `unreadable`). Root-safe (no chmod).
    mkdirSync(persistentRoleMarkerPath(root), { recursive: true });
    expect(readPersistentRoleResult(root).kind).toBe("unreadable");
    expect(() => resolveBoundStateRoot(root)).toThrow(StateRootIsolationError);
  });

  test("an explicit root with a MALFORMED persistent marker is refused (F7)", () => {
    const root = join(sandbox, "malformed-marker-root");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(persistentRoleMarkerPath(root), "not-a-real-role\n");
    expect(readPersistentRoleResult(root).kind).toBe("unreadable");
    expect(() => resolveBoundStateRoot(root)).toThrow(StateRootIsolationError);
  });

  test("F1 cold-start: production binds its default root; a non-production launch with no root refuses", () => {
    // The remote durable padi is launched `--role production` (which bin.ts turns into
    // KOLU_ROLE=production) — so it binds its own DEFAULT root instead of being refused.
    expect(() => resolveBoundStateRoot()).toThrow(StateRootIsolationError);
    process.env.KOLU_ROLE = "production";
    expect(resolveBoundStateRoot()).toBe(defaultRoot());
  });

  test("the atomic marker write leaves production readable and no transient tmp file", () => {
    const root = join(sandbox, "atomic-root");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writePersistentProductionMarker(root);
    expect(readPersistentRoleResult(root)).toEqual({
      kind: "role",
      role: "production",
    });
    // No `.tmp` sibling lingers — the write renamed into place.
    expect(readdirSync(root).some((n) => n.includes(".tmp"))).toBe(false);
  });
});
