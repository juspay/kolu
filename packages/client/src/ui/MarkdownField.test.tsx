// @vitest-environment happy-dom
/**
 * SPELL-CHECKING OFF stays off. `spellcheck` is an ENUMERATED attribute, not a
 * boolean one: the word `"false"` turns the browser's checker off, and a
 * MISSING attribute means "inherit", which on a textarea is on. Solid 2 removes
 * an attribute given `false`, so the word has to be written.
 */

import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";
import MarkdownField from "./MarkdownField";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('writes spellcheck="false" on the markdown textarea', () => {
  const host = document.createElement("div");
  dispose = render(
    () => (
      <MarkdownField
        value=""
        onInput={() => {}}
        onSubmit={() => {}}
        placeholder=""
        textareaTestId="md"
        previewTestId="md-preview"
      />
    ),
    host,
  );
  const area = host.querySelector<HTMLTextAreaElement>('[data-testid="md"]');
  expect(area?.getAttribute("spellcheck")).toBe("false");
});
