// @vitest-environment happy-dom
import Dialog from "@corvu-next/dialog";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../canvas/activeTerminal", () => ({
  getActiveTerminalNode: () => null,
  getFirstTerminalNode: () => null,
}));
vi.mock("../useMobile", () => ({ isTouch: () => false }));

import ModalDialog from "./ModalDialog";
import { useDialogStack } from "./useDialogStack";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

async function pressEscape(escapeCloses: boolean) {
  const [open, setOpen] = createSignal(true);
  const changes: boolean[] = [];
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <ModalDialog
        open={open()}
        escapeCloses={escapeCloses}
        onOpenChange={(next) => {
          changes.push(next);
          setOpen(next);
        }}
      >
        <Dialog.Content data-testid="content">made-up</Dialog.Content>
      </ModalDialog>
    ),
    root,
  );
  await new Promise((done) => setTimeout(done, 20));
  const stack = useDialogStack();
  // What a listener BEHIND the dialog sees of the press itself (was it already
  // handled), and what the stack says once the frame that press provoked has
  // landed. Solid 2 stages the open/close bookkeeping, so the count a consumer
  // acts on (`refocusIfNoDialogOpen` reads it in a `requestAnimationFrame`) is
  // the one after the flush, never the one mid-dispatch.
  const handledTrail: boolean[] = [];
  const listener = (event: KeyboardEvent) =>
    handledTrail.push(event.defaultPrevented);
  window.addEventListener("keydown", listener);
  document.querySelector('[data-testid="content"]')?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  window.removeEventListener("keydown", listener);
  flush();
  const behind = handledTrail.map((handled) => ({
    handled,
    dialogs: stack.openCount(),
  }));
  return { changes, behind };
}

/** Open a dialog that names its own `initialFocusEl`, with the page's focus
 *  starting OUTSIDE it — the shape every editor dialog has (`IntentEditorDialog`
 *  hands Corvu its textarea while the terminal holds focus). Answers where
 *  focus ended up once Corvu's trap has had its two frames. */
async function openAndSettleFocus() {
  root = document.createElement("div");
  document.body.append(root);
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  const [fieldRef, setFieldRef] = createSignal<HTMLTextAreaElement>();
  dispose = render(
    () => (
      <ModalDialog open onOpenChange={() => {}} initialFocusEl={fieldRef()}>
        <Dialog.Content data-testid="content">
          <textarea ref={setFieldRef} data-testid="field" />
        </Dialog.Content>
      </ModalDialog>
    ),
    root,
  );
  // `afterPaint` is two `requestAnimationFrame`s deep inside Corvu's trap.
  for (let frame = 0; frame < 20; frame++) {
    await new Promise((done) => setTimeout(done, 16));
    if (document.activeElement?.getAttribute("data-testid") === "field") break;
  }
  const landed = document.activeElement;
  outside.remove();
  return landed;
}

describe("ModalDialog", () => {
  it("marks the Esc that closes it as handled, so nothing behind it takes the same press", async () => {
    const { changes, behind } = await pressEscape(true);
    expect(changes).toEqual([false]);
    expect(behind).toEqual([{ handled: true, dialogs: 0 }]);
  });

  it("leaves alone an Esc it does not close on, and still counts as open", async () => {
    const { changes, behind } = await pressEscape(false);
    expect(changes).toEqual([]);
    expect(behind).toEqual([{ handled: false, dialogs: 1 }]);
  });

  it("takes focus off the page and onto the element the dialog names", async () => {
    const landed = await openAndSettleFocus();
    expect(landed?.getAttribute("data-testid")).toBe("field");
  });
});
