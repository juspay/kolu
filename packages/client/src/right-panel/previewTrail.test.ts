/**
 * Preview trail semantics — the second host of `@kolu/solid-browser`.
 * L = { port, path }; isSameEntry on both fields so reload refreshes in
 * place; ◀/▶ return prior locations the host re-issues as previewOpen.
 */

import { samePreviewLocation } from "@kolu/padi/surface";
import { createBrowser, DEFAULT_MAX_ENTRIES } from "@kolu/solid-browser";
import { describe, expect, it } from "vitest";

describe("preview trail (createBrowser L = {port,path})", () => {
  it("reload of the same location refreshes in place", () => {
    const b = createBrowser({
      isSameEntry: samePreviewLocation,
      maxEntries: DEFAULT_MAX_ENTRIES,
    });
    b.navigate({ port: 5173, path: "/" });
    b.navigate({ port: 5173, path: "/a" });
    expect(b.length()).toBe(2);
    b.navigate({ port: 5173, path: "/a" }); // reload
    expect(b.length()).toBe(2);
    expect(b.current()).toEqual({ port: 5173, path: "/a" });
  });

  it("back returns the prior location without recording", () => {
    const b = createBrowser({ isSameEntry: samePreviewLocation });
    b.navigate({ port: 1, path: "/a" });
    b.navigate({ port: 1, path: "/b" });
    const prev = b.back();
    expect(prev).toEqual({ port: 1, path: "/a" });
    expect(b.canForward()).toBe(true);
    // A navigate after back forks — drops forward.
    b.navigate({ port: 1, path: "/c" });
    expect(b.canForward()).toBe(false);
    expect(b.length()).toBe(2);
  });

  it("a server-pushed navigation records onto this viewer's trail", () => {
    const b = createBrowser({ isSameEntry: samePreviewLocation });
    b.navigate({ port: 1, path: "/" });
    // MCP navigates to /x — this viewer records it.
    b.navigate({ port: 1, path: "/x" });
    expect(b.canBack()).toBe(true);
    expect(b.back()).toEqual({ port: 1, path: "/" });
  });
});
