/**
 * Lifecycle — the two halves of the freshness contract that run in the page:
 *
 * - `reloadForUpdate` must be a PLAIN `location.reload()`. A normal reload
 *   always revalidates the `no-store` shell with the server, so the reloaded
 *   page IS the deployed shell. The cache-busting `?__surface_app_fresh`
 *   navigation (#1278) targeted a layer that was never stale — the loop it
 *   chased was the commit stamp riding inside an `immutable` hashed asset
 *   (kolu#1319) — and is retired; pin the plain reload so it doesn't creep back.
 * - `shellCommit` reads the build identity off the shell global the build
 *   injected, falling back to `"dev"` (never-stale) when absent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { SHELL_COMMIT_GLOBAL } from "./index";
import { reloadForUpdate, shellCommit } from "./lifecycle";

describe("reloadForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reloads in place — a normal reload revalidates the no-store shell (kolu#1319)", () => {
    const reload = vi.fn();
    const replace = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("location", {
      href: "https://zest:7692/",
      reload,
      replace,
      assign,
    });

    reloadForUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
    // No cache-busting navigation: the shell was never the stale layer, and a
    // busted URL would skip revalidating (and so curing) the bare-`/` entry.
    expect(replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("shellCommit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the commit the shell carries", () => {
    vi.stubGlobal("window", { [SHELL_COMMIT_GLOBAL]: "0fab0cc" });
    expect(shellCommit()).toBe("0fab0cc");
  });

  it('falls back to "dev" (never-stale) when the shell carries no stamp', () => {
    vi.stubGlobal("window", {});
    expect(shellCommit()).toBe("dev");
  });

  it('falls back to "dev" on an empty stamp', () => {
    vi.stubGlobal("window", { [SHELL_COMMIT_GLOBAL]: "" });
    expect(shellCommit()).toBe("dev");
  });
});
