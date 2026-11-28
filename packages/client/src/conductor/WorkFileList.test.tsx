// @vitest-environment happy-dom
/**
 * A FOLDER CHIP'S KEPT BYTES follow the rows. The size used to be computed at
 * the top of the `<Show>`'s child body, which Solid runs untracked — a one-time
 * snapshot, and a STRICT_READ_UNTRACKED diagnostic the test setup fails on.
 */

import { Option } from "effect";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import WorkFileList from "./WorkFileList";
import type { WorkFileRow } from "./workFile";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("repaints a folder chip's kept bytes when the rows change", () => {
  const [rows, setRows] = createSignal<ReadonlyArray<WorkFileRow>>([
    { path: ".waterfall/mockup/one.md", bytes: Option.some(1024) },
  ]);
  const host = document.createElement("div");
  dispose = render(
    () => (
      <WorkFileList
        rows={rows()}
        more={false}
        openTo={undefined}
        layout="wrap"
        onOpen={() => {}}
      />
    ),
    host,
  );
  const chip = () =>
    host.querySelector<HTMLElement>('[data-testid="work-folder"]')?.textContent;

  expect(chip()).toContain("1 KiB");

  setRows([{ path: ".waterfall/mockup/one.md", bytes: Option.some(4096) }]);
  flush();
  expect(chip()).toContain("4 KiB");
});
