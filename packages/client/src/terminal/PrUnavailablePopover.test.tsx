// @vitest-environment happy-dom
/**
 * THE RECOVERY POPOVER'S CONTENT follows the reason. The two dispatches used to
 * be the component's EXPRESSION BODY — `match(props.source)` / `match(props.code)`
 * — which Solid runs untracked: the first unavailable reason froze on screen,
 * and the dev runtime raises STRICT_READ_UNTRACKED (which the test setup fails
 * on). The call site hands a `<Show>` accessor, so the source really does change
 * under a mounted popover.
 */

import type { PrUnavailableSource } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { ProviderUnavailableContent } from "./PrUnavailablePopover";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("repaints when the unavailable reason changes", () => {
  const [source, setSource] = createSignal<PrUnavailableSource>({
    provider: "gh",
    code: "not-authenticated",
  });
  const host = document.createElement("div");
  dispose = render(
    () => <ProviderUnavailableContent source={source()} />,
    host,
  );

  expect(host.textContent).toContain("GitHub not authenticated");

  setSource({ provider: "gh", code: "timed-out" });
  flush();
  expect(host.textContent).toContain("GitHub timed out");
  expect(host.textContent).not.toContain("GitHub not authenticated");
});
