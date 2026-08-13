/**
 * The two files a CONSUMER'S NODE loads directly, loaded by that same Node.
 *
 * `./vite` has always said this about itself — a Vite config imports it through
 * Node's ESM loader, which cannot resolve this package's extensionless relative
 * imports — and is written self-contained because of it. What that note missed is
 * that a Vite config also imports the package ROOT: kolu's own
 * `packages/client/vite.config.ts` takes `ASSET_DIR` and `NOTIFICATION_SW_SOURCE`
 * from `@kolu/surface-app`. So `./index` carries the identical constraint, and
 * one `from "./anything"` in it — a re-export included — is
 * `ERR_MODULE_NOT_FOUND` at every consumer's `vite dev`.
 *
 * Nothing else in this package can see that. Vitest, Bun and every bundler
 * resolve those imports happily; the whole suite stays green while the dev server
 * of every consumer is dead. It cost a red `ci::dev-smoke` (a 3-minute lane, and
 * the failure reads as "timed out waiting for http://localhost:…") to find once.
 * These two spawns are that lane's cheap twin: they fail in milliseconds, in the
 * package that owns the mistake, naming it.
 *
 * Node's own loader is the only oracle here, so this shells out to it rather than
 * importing anything — Node 24 strips the types on the way in.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Load `file` in a fresh Node, through Node's ESM resolver, and report what
 *  came back — the module's export names, or the loader's own error. */
const loadUnderNode = (file: string): string =>
  execFileSync(
    process.execPath,
    [
      "-e",
      `import(${JSON.stringify(resolve(import.meta.dirname, file))})
         .then((m) => console.log(Object.keys(m).join(",")))
         .catch((e) => { console.log("LOAD FAILED: " + e.code + " " + e.message); process.exitCode = 1; })`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

describe("the entries a consumer's Node loads directly", () => {
  it("`.` loads under Node's own ESM loader — a Vite config imports it", () => {
    // The names are asserted, not just the absence of a throw: a file that
    // loaded but exported nothing would satisfy the weaker check.
    const exports = loadUnderNode("./index.ts").split(",");
    expect(exports).toContain("ASSET_DIR");
    expect(exports).toContain("NOTIFICATION_SW_SOURCE");
    expect(exports).toContain("injectShellCommit");
  });

  it("`/vite` loads under Node's own ESM loader — that is what a plugin IS", () => {
    const exports = loadUnderNode("./vite.ts").split(",");
    expect(exports).toContain("surfaceApp");
    expect(exports).toContain("resolveCommit");
  });
});
