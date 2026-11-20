import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  koluRoot,
  koluScratchDir,
  koluShellDir,
  setDaemonProcessId,
} from "./koluRoot.ts";

describe("daemonProcessId boot-order fail-fast", () => {
  const NOT_INJECTED =
    "daemonProcessId read before setDaemonProcessId() — the daemon's boot (padi's daemonMain) must inject it before ensureKoluRoot";

  it("throws a named error when a root is read before the setter runs", () => {
    expect(() => koluRoot()).toThrow(NOT_INJECTED);
    expect(() => koluShellDir()).toThrow(NOT_INJECTED);
    expect(() => koluScratchDir()).toThrow(NOT_INJECTED);
  });

  it("derives the roots from the injected id once the setter runs", () => {
    const id = "0199f0e2-1a2b-4c3d-8e4f-boot0test0id";
    setDaemonProcessId(id);
    const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
    const expectedRoot = join(runtimeRoot, `kolu-${id}`);
    expect(koluRoot()).toBe(expectedRoot);
    expect(koluShellDir()).toBe(join(expectedRoot, "shell"));
    expect(koluScratchDir()).toBe(join(expectedRoot, "scratch"));
  });

  it("still rejects an empty id in the setter", () => {
    expect(() => setDaemonProcessId("")).toThrow("setDaemonProcessId: empty");
  });
});
