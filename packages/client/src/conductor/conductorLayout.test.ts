import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONDUCTOR_HELP_FALLBACK,
  CONDUCTOR_WIDE_FALLBACK,
} from "./conductorLayout";

// `fileURLToPath` + `node:path`, not `new URL(…, import.meta.url)`: the test
// env's global `URL` is the browser one, which rejects a `file:` base.
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
  "utf8",
);

function rem(token: string): number {
  const found = CSS.match(new RegExp(`${token}:\\s*([0-9.]+)rem;`));
  if (found?.[1] === undefined) {
    throw new Error(`${token} is not declared in rem in index.css`);
  }
  return Number(found[1]);
}

describe("the Conductor's two-column breakpoint", () => {
  it("is the reading column, the side column and the gutter added up", () => {
    expect(rem("--breakpoint-conductor-wide")).toBe(
      rem("--container-conductor") +
        rem("--container-conductor-side") +
        rem("--spacing-conductor-gutter"),
    );
  });

  it("is the two-column sum plus the help's own track", () => {
    expect(rem("--breakpoint-conductor-help")).toBe(
      rem("--breakpoint-conductor-wide") +
        rem("--container-conductor-help") +
        rem("--spacing-conductor-gutter"),
    );
  });

  it("needs more room for the help than for the side column alone", () => {
    expect(rem("--breakpoint-conductor-help")).toBeGreaterThan(
      rem("--breakpoint-conductor-wide"),
    );
  });

  it("flips at the same pixel before the stylesheet has applied", () => {
    expect(CONDUCTOR_WIDE_FALLBACK).toBe(
      `${rem("--breakpoint-conductor-wide")}rem`,
    );
    expect(CONDUCTOR_HELP_FALLBACK).toBe(
      `${rem("--breakpoint-conductor-help")}rem`,
    );
  });

  it("holds 70 to 90 characters a line at the chat's own text size", () => {
    const AVG_CHAR_EM = 0.52;
    const READING_GUTTER_REM = 1.25;
    const textRem = rem("--container-conductor") - 2 * READING_GUTTER_REM;
    const size = rem("--text-chat");
    const characters = textRem / (size * AVG_CHAR_EM);
    expect(characters).toBeGreaterThanOrEqual(70);
    expect(characters).toBeLessThanOrEqual(90);
  });
});
