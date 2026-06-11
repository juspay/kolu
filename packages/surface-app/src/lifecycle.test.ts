/**
 * Lifecycle navigation — the one production-critical action worth pinning down
 * in isolation: `reloadForUpdate`. The pure URL kernel (`cacheBustedShellUrl`)
 * is covered in `index.test.ts`; here we assert the *entry point* the update
 * prompt actually calls navigates with a cache-busting URL via
 * `location.replace` — NOT a plain `location.reload()`, which is exactly the
 * regression that re-opens the infinite-reload loop (see `docs/cache-bug.md`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheBustedShellUrl } from "./index";
import { reloadForUpdate } from "./lifecycle";

describe("reloadForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("navigates to the cache-busted shell URL with a fresh token (not a plain reload)", () => {
    const replace = vi.fn();
    const reload = vi.fn();
    const href = "https://zest:7692/";
    vi.stubGlobal("location", { href, replace, reload });
    // Pin Date.now so the token — and thus the expected URL — is deterministic.
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    reloadForUpdate();

    // A *normal* reload is the bug: a poisoned `/` entry would re-serve the
    // stale shell and re-open the loop. The fix must navigate to a busted key.
    expect(reload).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(
      cacheBustedShellUrl(href, String(now)),
    );
  });
});
