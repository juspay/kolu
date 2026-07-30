/**
 * Where padi's client toolchain comes from — the fact it is TOLD, never derives.
 *
 * These pin the parsing AND the deliberate absence: a daemon with no baked
 * toolchain must report `[]` (and so inject nothing) rather than guess a path
 * from `process.execPath` / `argv[1]` / a PATH search. A guess would resolve to
 * the tsx loader or to whatever build happens to be installed on the host, which
 * is exactly the version skew this indirection exists to make unspellable.
 */

import { AGENT_TOOLS_PATH_ENV } from "kolu-pty";
import { describe, expect, it } from "vitest";
import { resolveAgentToolsPath } from "./agentTools.ts";

describe("resolveAgentToolsPath", () => {
  it("splits the colon-joined bake, preserving priority order", () => {
    expect(
      resolveAgentToolsPath({
        [AGENT_TOOLS_PATH_ENV]: "/nix/store/aaa/bin:/nix/store/bbb/bin",
      }),
    ).toEqual(["/nix/store/aaa/bin", "/nix/store/bbb/bin"]);
  });

  it("reports NO toolchain when unset or empty — never a guessed default", () => {
    // The from-source (`just dev` / e2e) daemon: no wrapper, so nothing baked.
    expect(resolveAgentToolsPath({})).toEqual([]);
    expect(resolveAgentToolsPath({ [AGENT_TOOLS_PATH_ENV]: "" })).toEqual([]);
  });

  it("drops empty segments so no entry can mean 'the current directory'", () => {
    // An empty PATH entry is CWD to a POSIX shell — a real hazard, not cosmetic.
    // A trailing/doubled colon from a shell-side prefix must not become one.
    expect(
      resolveAgentToolsPath({ [AGENT_TOOLS_PATH_ENV]: "/a::/b:" }),
    ).toEqual(["/a", "/b"]);
  });
});
