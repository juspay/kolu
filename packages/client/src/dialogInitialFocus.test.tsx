// @vitest-environment happy-dom
/**
 * WHERE A DIALOG PUTS THE FOCUS WHEN IT OPENS, through the real chain —
 * `ModalDialog` › Corvu `Dialog` › the trap. Corvu reads `initialFocusEl`
 * lazily, two animation frames after the open edge, so a ref handed to it has
 * to be a SIGNAL: a bare `let` is read at the JSX site, before the element
 * exists, and the trap silently falls back to the first focusable inside the
 * content.
 *
 * For `CloseConfirm` that fallback is a real defect: a terminal with an active
 * PR renders the PR link above Cancel, so the dialog would open with focus on
 * an external link where Enter opens a new tab, instead of on its safe default.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./canvas/activeTerminal", () => ({
  getActiveTerminalNode: () => null,
  getFirstTerminalNode: () => null,
}));
vi.mock("./useMobile", () => ({ isTouch: () => false }));
vi.mock("./terminal/useTerminalCrud", () => ({
  useTerminalCrud: () => ({ exportSessionHtml: () => Promise.resolve() }),
}));
// Loaded after the mocks are registered — a static import would hoist above
// them and bind the real services. (The sibling `CommandPalette.modal.test`
// chain does the same for the same reason.)
const { default: CloseConfirm } = await import("./CloseConfirm");
const { default: ExportSessionDialog, exportSessionDialog } = await import(
  "./ExportSessionDialog"
);

const ID = "33333333-3333-4333-8333-333333333333" as TerminalId;

/** A terminal that is active and carries a resolved PR — the case where the
 *  PR link is rendered, and is the first focusable in the dialog. */
const META_WITH_PR = {
  id: ID,
  state: "active",
  title: "term",
  git: { kind: "none" },
  pr: {
    kind: "ok",
    value: {
      number: 2438,
      title: "Solid 2.0.4",
      url: "https://example.invalid/pr/2438",
      state: "open",
      checks: null,
      checkRuns: [],
      reviewDecision: null,
    },
  },
} as unknown as TerminalMetadata;

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;
let outside: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  outside?.remove();
  dispose = undefined;
  root = undefined;
  outside = undefined;
});

/** Mount with the page's focus OUTSIDE the dialog (what every open starts
 *  from) and let Corvu's trap have its frames. Deliberately no early break on
 *  the expected element: the defect is a LATER focus, which a break hides. */
async function settleFocus(mount: () => JSX.Element) {
  root = document.createElement("div");
  document.body.append(root);
  outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  dispose = render(mount, root);
  flush();
  for (let frame = 0; frame < 8; frame++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 16);
    await promise;
  }
  const el = document.activeElement;
  if (!el || el === document.body) return "none";
  return (
    el.getAttribute("data-testid") ??
    `<${el.tagName.toLowerCase()}> ${el.textContent?.trim() ?? ""}`
  );
}

it("puts the close dialog's focus on Cancel, not on the terminal's PR link", async () => {
  const landed = await settleFocus(() => (
    <CloseConfirm
      target={{ id: ID, meta: META_WITH_PR, splitCount: 0 }}
      onCancel={() => {}}
      onClose={() => {}}
      onCloseAndRemove={() => {}}
    />
  ));
  // The PR link is rendered — it is what the trap's fallback would take.
  expect(document.querySelector('[data-testid="close-confirm-pr"]')).not.toBe(
    null,
  );
  expect(landed).toBe("close-confirm-cancel");
});

it("puts the export dialog's focus on its Chat log button", async () => {
  exportSessionDialog.openDialog();
  const landed = await settleFocus(() => <ExportSessionDialog />);
  exportSessionDialog.close();
  expect(landed).toBe("<button> Chat logSmall file · You and AI messages");
});
