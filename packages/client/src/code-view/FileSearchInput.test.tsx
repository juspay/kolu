// @vitest-environment happy-dom
/**
 * SPELL-CHECKING OFF stays off on the file filter. `spellcheck` is an
 * ENUMERATED attribute, not a boolean one: the word `"false"` turns the
 * browser's checker off, and a MISSING attribute means "inherit". Solid 2
 * removes an attribute given `false`, so the word has to be written.
 */

import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";
import FileSearchInput from "./FileSearchInput";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('writes spellcheck="false" on the file filter', () => {
  const host = document.createElement("div");
  dispose = render(
    () => <FileSearchInput value="" onChange={() => {}} />,
    host,
  );
  const input = host.querySelector<HTMLInputElement>(
    '[data-testid="diff-filter-search"]',
  );
  expect(input?.getAttribute("spellcheck")).toBe("false");
});
