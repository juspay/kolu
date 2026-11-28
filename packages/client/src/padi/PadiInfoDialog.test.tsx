// @vitest-environment happy-dom
/**
 * THE DEGRADED-BIND BANNER'S EVIDENCE follows the standing anomaly. The arm's
 * values used to be read at the top of a `<Show>`'s child body covering two
 * convergence kinds, which Solid runs untracked: a one-time snapshot, and a
 * STRICT_READ_UNTRACKED diagnostic on the dev runtime.
 */

import type { PadiConvergence } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { ConvergenceBanner } from "./PadiInfoDialog";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

const identity = (contractVersion: string, buildId: string) => ({
  contractVersion,
  build: { kind: "known" as const, id: buildId },
});

it("repaints the arm's evidence when the standing anomaly changes", () => {
  const [conv, setConv] = createSignal<PadiConvergence>({
    kind: "adopted-stale",
    running: identity("1.0", "aaa"),
    expected: identity("1.0", "bbb"),
    detail: "riding the resident daemon",
  });
  const host = document.createElement("div");
  dispose = render(() => <ConvergenceBanner conv={conv()} />, host);

  expect(host.textContent).toContain("running aaa · expected bbb");

  setConv({
    kind: "adopted-stale",
    running: identity("1.0", "ccc"),
    expected: identity("1.0", "ddd"),
    detail: "riding the resident daemon",
  });
  flush();
  expect(host.textContent).toContain("running ccc · expected ddd");
});
