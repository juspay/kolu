import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WEB_URL_PATTERN } from "@kolu/url-shape";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function addonDefaultUrlRegexSource(): string {
  const pkgRoot = dirname(
    require.resolve("@xterm/addon-web-links/package.json"),
  );
  const src = readFileSync(join(pkgRoot, "src/WebLinksAddon.ts"), "utf8");
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
