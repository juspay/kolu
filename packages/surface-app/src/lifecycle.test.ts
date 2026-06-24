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
// `registerOrRetireServiceWorker` is imported only for its TYPE here — the tests
// re-import it through a fresh module each case (see `freshLifecycle`) so the
// module-load-time `swApiAvailable` const reads the stubbed `navigator`.
import type { registerOrRetireServiceWorker } from "./lifecycle";
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

describe("registerOrRetireServiceWorker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // `swApiAvailable` is captured at module load, so each case stubs `navigator`
  // first, then re-imports the module fresh to read it under that stub.
  async function freshLifecycle(serviceWorker: unknown): Promise<{
    register: typeof registerOrRetireServiceWorker;
  }> {
    // `swApiAvailable` gates on `"serviceWorker" in navigator`, so the absent
    // case must OMIT the key entirely, not set it to undefined.
    vi.stubGlobal(
      "navigator",
      serviceWorker === undefined ? {} : { serviceWorker },
    );
    vi.resetModules();
    const mod = await import("./lifecycle");
    return { register: mod.registerOrRetireServiceWorker };
  }

  it("registers and does NOT retire when registration succeeds", async () => {
    const register = vi.fn().mockResolvedValue({});
    const getRegistrations = vi.fn().mockResolvedValue([]);
    const { register: run } = await freshLifecycle({
      register,
      getRegistrations,
    });

    await run("/sw.js");

    expect(register).toHaveBeenCalledWith("/sw.js");
    // The success path leaves the registered worker in place — retirement, which
    // would tear it back down via getRegistrations(), must never fire.
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it("logs and retires when registration rejects (e.g. dev, no /sw.js)", async () => {
    const unregister = vi.fn();
    const register = vi.fn().mockRejectedValue(new Error("404"));
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    // retireServiceWorker also sweeps caches; stub the global so it no-ops.
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    });
    const { register: run } = await freshLifecycle({
      register,
      getRegistrations,
    });

    await run();

    expect(register).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenCalled();
    // Retirement ran: it enumerated registrations and unregistered the stale one,
    // so a failed register leaves the origin with NO worker, never a half-state.
    expect(getRegistrations).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());

    debug.mockRestore();
  });

  it("no-ops where the service-worker API is absent", async () => {
    const { register: run } = await freshLifecycle(undefined);
    // Resolves without throwing — registerServiceWorker returns null, the policy
    // settles, nothing to retire.
    await expect(run()).resolves.toBeUndefined();
  });
});
