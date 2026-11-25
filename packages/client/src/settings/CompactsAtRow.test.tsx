// @vitest-environment happy-dom
/**
 * SPELL-CHECKING OFF stays off on the Conductor's custom compaction field.
 * `spellcheck` is an ENUMERATED attribute, not a boolean one: the word
 * `"false"` turns the browser's checker off, and a MISSING attribute means
 * "inherit". Solid 2 removes an attribute given `false`, so the word has to
 * be written.
 */

import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../wire", () => ({
  // A saved count that is neither the default nor the model limit: the row
  // reads itself as "custom", so the typed field is on screen.
  preferences: () => ({ conductorCompactsAt: 120_000 }),
  updatePreferences: () => {},
}));

import CompactsAtRow from "./CompactsAtRow";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('writes spellcheck="false" on the custom compaction field', () => {
  const host = document.createElement("div");
  dispose = render(() => <CompactsAtRow />, host);
  const field = host.querySelector<HTMLInputElement>(
    '[data-testid="conductor-compacts-at-field"]',
  );
  expect(field?.getAttribute("spellcheck")).toBe("false");
});
