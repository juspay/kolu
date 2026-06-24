import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MOONLIT } from "./moonlit.ts";

const require = createRequire(import.meta.url);

// The sleeping ☾ accent lives in two homes on purpose: this client palette
// (`MOONLIT.accent`, a TS literal read by the dormant tile + minimap, which need
// the raw value to string-interpolate a `border:`/`background:`) and the
// `@kolu/theme` `--color-moonlit` token (which the shared `StatePip` ☾ reads as
// `text-moonlit`). MOONLIT stays a self-contained palette — its other five
// colours have no theme token — rather than fragmenting just `accent` onto the
// token (the lens-debate verdict, finding hickey-6). This guard is the cheap
// alternative: it pins the two literals equal so the cross-file claim in
// moonlit.ts / theme.css can't silently drift.
describe("moonlit ☾ accent", () => {
  it("matches the --color-moonlit token in @kolu/theme", () => {
    const themeCss = readFileSync(
      require.resolve("@kolu/theme/theme.css"),
      "utf8",
    );
    const match = themeCss.match(/--color-moonlit:\s*(#[0-9a-fA-F]{3,8})\s*;/);
    expect(match, "theme.css must define --color-moonlit").not.toBeNull();
    expect(match?.[1]?.toLowerCase()).toBe(MOONLIT.accent.toLowerCase());
  });
});
