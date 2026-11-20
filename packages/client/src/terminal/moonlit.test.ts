/// <reference types="node" />

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MOONLIT } from "./moonlit.ts";

const require = createRequire(import.meta.url);

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
