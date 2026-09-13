/** `@kolu/url-shape`'s `WEB_URL_PATTERN` is a hand-copied restatement of
 *  `@xterm/addon-web-links`'s internal `strictUrlRegex` — copied rather than
 *  imported because the addon never exports it (confirmed by
 *  `typings/addon-web-links.d.ts` below: only `WebLinksAddon` is public).
 *  `xtermLifecycle.ts` passes `WEB_URL_PATTERN` as the addon's `urlRegex`
 *  precisely so the terminal's live click detection uses OUR copy rather than
 *  the addon's internal default, which means an addon upgrade can never
 *  desync live click behavior from the printed-port scanner. What it CAN
 *  desync is the premise the copy stands on — that our literal still equals
 *  the addon's current default. This test reads that default straight out of
 *  the installed package's TypeScript source (the same file the copy was
 *  transcribed from) instead of trusting the copy by eye, so a future addon
 *  release that changes its default regex fails HERE, loudly, rather than
 *  silently drifting the "terminal underline ⇔ printed-port index" invariant
 *  the source comment on `WEB_URL_PATTERN` claims holds "by construction". */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WEB_URL_PATTERN } from "@kolu/url-shape";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/** The addon's real, current default — scraped from its own source (the
 *  `.source` body between the literal's delimiting slashes, no `eval`
 *  involved) rather than re-declared here, so there is exactly one place this
 *  literal lives outside the dependency itself. */
function addonDefaultUrlRegexSource(): string {
  const pkgRoot = dirname(
    require.resolve("@xterm/addon-web-links/package.json"),
  );
  const src = readFileSync(join(pkgRoot, "src/WebLinksAddon.ts"), "utf8");
  // The declaration is a single line with exactly one closing `/;` — the
  // regex body itself contains no other `/` immediately before a `;`.
  const m = /const strictUrlRegex = \/(.*)\/;/.exec(src);
  const body = m?.[1];
  if (body === undefined) {
    throw new Error(
      "could not find `strictUrlRegex` in @xterm/addon-web-links' source — " +
        "the addon's internals moved; re-locate the anchor and, if the regex " +
        "itself changed, update WEB_URL_PATTERN in @kolu/url-shape to match.",
    );
  }
  return body;
}

describe("WEB_URL_PATTERN pins @xterm/addon-web-links' current default", () => {
  it("is byte-for-byte the addon's own strictUrlRegex source", () => {
    expect(WEB_URL_PATTERN.source).toBe(addonDefaultUrlRegexSource());
  });
});
