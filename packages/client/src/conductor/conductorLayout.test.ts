/**
 * THE BREAKPOINT IS THE SUM OF THE TWO COLUMNS, not a number somebody liked.
 *
 * `index.css` states the reading column, the side column and the gutter
 * between them; the width at which both fit is their sum, and
 * `--breakpoint-conductor-wide` is what both Tailwind's `conductor-wide:`
 * utilities and `conductorLayout.ts`'s `matchMedia` flip on. Widen the
 * reading column without moving the breakpoint and the side column starts
 * overlapping the conversation on exactly the windows between the old sum and
 * the new one — a defect nobody sees until a window is that width.
 *
 * So this reads the four tokens out of the stylesheet and does the addition.
 * It pins a DERIVATION, not a look: every measure here is free to change, as
 * long as the one that is the sum of the others still is.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath` + `node:path`, not `new URL(…, import.meta.url)`: the test
// env's global `URL` is the browser one, which rejects a `file:` base.
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
  "utf8",
);

/** A `--token: <n>rem;` declaration, in rem. Fails loudly rather than
 *  defaulting: a token that has been renamed or given a non-rem value is a
 *  thing to look at, not to skip. */
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

  it("holds 70 to 90 characters a line at the chat's own text size", () => {
    // The column's gutters (1.25rem a side, `px-5` on the reading column) are
    // not text, and an average character in DM Sans is about 0.52em.
    const textRem = rem("--container-conductor") - 2 * 1.25;
    const size = rem("--text-chat");
    const characters = textRem / (size * 0.52);
    expect(characters).toBeGreaterThanOrEqual(70);
    expect(characters).toBeLessThanOrEqual(90);
  });
});
