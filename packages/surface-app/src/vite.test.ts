/**
 * The Vite plugin must put the commit on the SHELL, never into the bundle.
 *
 * A bundler `define` bakes the commit into a content-hashed `/assets/*` file —
 * then a post-build stamp (kolu's `koluStamped`) rewrites the bytes of a file
 * whose NAME doesn't change, and every returning browser is pinned on the old
 * stamp by the year-long `immutable` cache (kolu#1319). `vite.ts` is
 * deliberately self-contained (Node's ESM loader can't resolve extensionless
 * relative imports), so it can't import `SHELL_COMMIT_GLOBAL` — these tests
 * are the lockstep guard between its literal and the kernel constant.
 */

import { describe, expect, it } from "vitest";
import { SHELL_COMMIT_GLOBAL, shellCommitScriptBody } from "./index";
import { surfaceApp } from "./vite";

describe("surfaceApp (vite plugin)", () => {
  it("injects the commit onto the shell global via transformIndexHtml", () => {
    const plugin = surfaceApp({ commit: "0fab0cc" });
    expect(plugin.transformIndexHtml()).toEqual([
      {
        tag: "script",
        children: `window.${SHELL_COMMIT_GLOBAL}=${JSON.stringify("0fab0cc")}`,
        injectTo: "head-prepend",
      },
    ]);
  });

  // The vite plugin re-implements the script body inline (it can't import the
  // kernel across Node's ESM boundary — see the vite.ts header). This pins that
  // byte-copy to the ONE authoritative `shellCommitScriptBody`, across hostile
  // commits the escape exists for — a `</script>` breakout and a bare `<` — not
  // just a clean short SHA. If either side hardens its escape, this fails.
  it.each([
    "0fab0cc",
    "</script><script>alert(1)",
    "a<b",
    'with"quote',
  ])("emits exactly shellCommitScriptBody(%j)", (commit) => {
    const [tag] = surfaceApp({ commit }).transformIndexHtml();
    expect(tag?.children).toBe(shellCommitScriptBody(commit));
  });

  it("defines NOTHING into the bundle — the define path is retired (kolu#1319)", () => {
    const plugin = surfaceApp({ commit: "0fab0cc" });
    expect("config" in plugin).toBe(false);
  });
});
