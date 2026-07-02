/**
 * Boot-order fail-fast for the injected per-process server id (a W1.M severing).
 *
 * `setKoluServerProcessId` throws on an EMPTY value WHEN CALLED, but nothing
 * crashed if boot never called it at all — a downstream READ (koluRoot's dir
 * construction, `ensureKoluRoot`, the per-terminal scratch dir) then silently
 * derived a path from an unset id. These pin the READ as loud instead: a read
 * before the set throws a named error; a read after a set returns the derived
 * path unchanged (the happy path stays byte-identical).
 *
 * Module-level state persists across `it`s within one file, so the
 * read-before-set case MUST run first, before any set. Vitest runs `it`s in
 * definition order, and (default isolation) gives this file a fresh module graph
 * so no sibling test's set leaks in.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  koluRoot,
  koluScratchDir,
  koluShellDir,
  setKoluServerProcessId,
} from "./koluRoot.ts";

describe("koluServerProcessId boot-order fail-fast", () => {
  const NOT_INJECTED =
    "koluServerProcessId read before setKoluServerProcessId() — kolu-server boot must inject it before ensureKoluRoot";

  // FIRST: this fresh module graph has never had the id injected. A read here is
  // a boot-order bug and must crash loudly, not hand back an empty-id dir. (If
  // the getters were reverted to a plain read of a possibly-undefined holder,
  // this assertion goes red — the guard against a silent regression.)
  it("throws a named error when a root is read before the setter runs", () => {
    expect(() => koluRoot()).toThrow(NOT_INJECTED);
    expect(() => koluShellDir()).toThrow(NOT_INJECTED);
    expect(() => koluScratchDir()).toThrow(NOT_INJECTED);
  });

  it("derives the roots from the injected id once the setter runs", () => {
    const id = "0199f0e2-1a2b-4c3d-8e4f-boot0test0id";
    setKoluServerProcessId(id);
    const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
    const expectedRoot = join(runtimeRoot, `kolu-${id}`);
    expect(koluRoot()).toBe(expectedRoot);
    expect(koluShellDir()).toBe(join(expectedRoot, "shell"));
    expect(koluScratchDir()).toBe(join(expectedRoot, "scratch"));
  });

  it("still rejects an empty id in the setter", () => {
    // The empty check throws BEFORE assigning, so it does not clobber the id set
    // above — the existing empty-string rejection is preserved unchanged.
    expect(() => setKoluServerProcessId("")).toThrow(
      "setKoluServerProcessId: empty",
    );
  });
});
