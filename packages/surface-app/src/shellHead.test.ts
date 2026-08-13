/**
 * The shell's head prelude — the ONE splice, and the order inside it.
 *
 * The order is the whole point: a `modulepreload` the parser reaches AFTER the
 * script that needs it saves nothing, so "links first, identity second" is a
 * property worth a test rather than a property of which line was typed first.
 * `injectShellCommit`'s own contract (the `<head>` locator, the `<header>` trap,
 * the escape) is pinned in `index.test.ts`, where it is public.
 */

import { describe, expect, it } from "vitest";
import { shellCommitScript } from "./index";
import { injectShellHead } from "./shellHead";

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body><script type="module" src="/assets/main-D85Q74Rn.js"></script></body>
</html>`;

describe("injectShellHead", () => {
  it("writes the preload links first and the commit script after, right after <head>", () => {
    // Pinned as a LITERAL, in one string: `rel="modulepreload"` is the whole
    // instruction to the browser, and the adjacency IS the order — a test that
    // rebuilt the tags from the same helper, or checked the two halves
    // separately, would agree with a typo or a swap.
    const out = injectShellHead(shell, {
      preloadHrefs: ["/assets/shared-a1b2c3d4.js", "/assets/base-e5f6a7b8.js"],
      commit: "0fab0cc",
    });
    expect(out).toContain(
      '<head><link rel="modulepreload" href="/assets/shared-a1b2c3d4.js">' +
        '<link rel="modulepreload" href="/assets/base-e5f6a7b8.js">' +
        shellCommitScript("0fab0cc"),
    );
    // And so ahead of the entry the preloaded chunks belong to.
    expect(out.indexOf("modulepreload")).toBeLessThan(
      out.indexOf("/assets/main-D85Q74Rn.js"),
    );
  });

  it("adds no preload tags when the entry split into nothing — just the identity", () => {
    // The no-split app is most apps. It must come out with no empty `<link>`, no
    // stray whitespace — nothing to explain.
    const out = injectShellHead(shell, { preloadHrefs: [], commit: "0fab0cc" });
    expect(out).not.toContain("modulepreload");
    expect(out).toBe(
      shell.replace("<head>", `<head>${shellCommitScript("0fab0cc")}`),
    );
  });

  it("throws on a template with no <head> — the head prelude must not silently vanish", () => {
    expect(() =>
      injectShellHead("<html><body></body></html>", {
        preloadHrefs: ["/assets/a-1.js"],
        commit: "0fab0cc",
      }),
    ).toThrow(/<head>/);
  });
});
