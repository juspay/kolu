// @vitest-environment happy-dom
/**
 * WHAT EACH DIALOG HANDS THE FOCUS TRAP, at the moment the trap reads it.
 *
 * Corvu does not read `initialFocusEl` at the JSX site: it reads it two
 * animation frames after the open edge (`@corvu-next/dialog`, `afterPaint`).
 * So the prop has to stay LIVE — a `createSignal` ref read inside the JSX
 * compiles to a getter, while a bare `let` compiles to a value captured at
 * creation, when the element does not exist yet, and the trap gets
 * `undefined` and falls back to the first focusable in the content.
 *
 * `dialogInitialFocus.test.tsx` watches where focus LANDS through the real
 * chain. That is the user-visible fact, but it can only distinguish the two
 * spellings where the intended element is NOT also the trap's fallback —
 * which is why `CloseConfirm` is the behavioural proof there and the export
 * dialog is not. This file asks the narrower question that bites at every
 * site: a `./ui/ModalDialog` double records the prop after mount, exactly
 * when Corvu would read it, and each dialog must name its own element.
 *
 * All six `initialFocusEl` call sites in the client go through `ModalDialog`,
 * so one double covers them all. `vi.mock` is file-scoped, which is why this
 * is its own file rather than a case in the behaviour test.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

/** What the double saw, in mount order. `vi.hoisted` because the factory
 *  below is hoisted above every other statement in this file. */
const recorder = vi.hoisted(() => ({
  reads: [] as Array<() => HTMLElement | undefined>,
}));

vi.mock("./ui/ModalDialog", async () => {
  const { default: Dialog } = await import("@corvu-next/dialog");
  const ModalDialog = (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialFocusEl?: HTMLElement;
    children: JSX.Element;
  }) => {
    // The prop is kept as a READER, not a value: reading it here, during
    // creation, is the very mistake this test is about. The test reads it
    // after the content has mounted — the window Corvu reads it in.
    recorder.reads.push(() => props.initialFocusEl);
    // The real `ModalDialog` is a Corvu root with a portal; the dialogs'
    // children are `Dialog.Content` / `Dialog.Label`, which need that root.
    // `initialFocusEl` is deliberately NOT forwarded: this file is about what
    // the dialog offers, and a live trap would move the page's focus around
    // the recorded answer.
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <Dialog.Portal forceMount>{props.children}</Dialog.Portal>
      </Dialog>
    );
  };
  return { default: ModalDialog, refocusTerminal: () => {} };
});

// The services the dialogs reach for — a socket, the host map, the active
// view, the memory cell — stubbed flat. Everything that DRAWS is the real
// component, so each ref is set by the real element.
vi.mock("./wire", () => ({
  encActiveHost: () => "local",
  activeHost: () => ({ kind: "local" }),
  padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
}));
vi.mock("./host/useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("./attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));
vi.mock("./host/HostIdentityLabel", () => ({
  HostIdentityLabel: () => <span />,
}));
vi.mock("./host/hostChipTone", () => ({
  hostHue: () => "0",
  hostLabel: () => "host",
}));
vi.mock("./settings/useTips", () => ({
  useTips: () => ({ peekAmbientTipText: () => "" }),
}));
vi.mock("./useViewState", () => ({
  useViewState: () => ({ activeId: () => null }),
}));
vi.mock("./palette/CreateIdentityPreview", () => ({ default: () => null }));
vi.mock("./canvas/activeTerminal", () => ({
  getActiveTerminalNode: () => null,
  getFirstTerminalNode: () => null,
}));
vi.mock("./useMobile", () => ({ isTouch: () => false }));
vi.mock("./terminal/useTerminalCrud", () => ({
  useTerminalCrud: () => ({ exportSessionHtml: () => Promise.resolve() }),
}));
vi.mock("./conductor/memory/useMemory", () => ({
  useMemory: () => ({
    approve: () => Promise.resolve(null),
    save: () => Promise.resolve(null),
  }),
}));

// Loaded after the mocks are registered — a static import would hoist above
// them and bind the real `ModalDialog`. (The sibling `dialogInitialFocus` and
// `CommandPalette.modal` chains do the same, for the same reason.)
const { default: CloseConfirm } = await import("./CloseConfirm");
const { default: ExportSessionDialog, exportSessionDialog } = await import(
  "./ExportSessionDialog"
);
const { default: CommandPalette } = await import("./CommandPalette");
const { ConductorHelpSheet } = await import("./conductor/ConductorHelp");
const { helpSheet } = await import("./conductor/helpContent");
const { Shown } = await import("./ui/shown");
const { default: MemoryEditor, editMemory } = await import(
  "./conductor/memory/MemoryEditor"
);
const { default: IntentEditorDialog } = await import(
  "./intent/IntentEditorDialog"
);

const ID = "44444444-4444-4444-8444-444444444444" as TerminalId;

const META = {
  id: ID,
  state: "active",
  title: "term",
  git: { kind: "none" },
  pr: { kind: "none" },
} as unknown as TerminalMetadata;

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  recorder.reads.length = 0;
});

/** Mount the dialog and answer what it is offering the trap once its content
 *  stands — Corvu's own read is two `requestAnimationFrame`s past the open
 *  edge, so the answer is taken after frames, not during creation. */
async function offeredFocusEl(
  mount: () => JSX.Element,
): Promise<HTMLElement | undefined> {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(mount, root);
  flush();
  for (let frame = 0; frame < 4; frame++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 16);
    await promise;
  }
  expect(recorder.reads).toHaveLength(1);
  const read = recorder.reads[0];
  if (read === undefined) throw new Error("no ModalDialog mounted");
  return read();
}

const found = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`not rendered: ${selector}`);
  return el;
};

it("has CloseConfirm offering its Cancel button", async () => {
  const offered = await offeredFocusEl(() => (
    <CloseConfirm
      target={{ id: ID, meta: META, splitCount: 0 }}
      onCancel={() => {}}
      onClose={() => {}}
      onCloseAndRemove={() => {}}
    />
  ));
  expect(offered).toBe(found('[data-testid="close-confirm-cancel"]'));
});

it("has the export dialog offering its Chat log button", async () => {
  exportSessionDialog.openDialog();
  const offered = await offeredFocusEl(() => <ExportSessionDialog />);
  exportSessionDialog.close();
  const chat = found('[data-testid="export-session-dialog"] button');
  expect(chat.textContent).toContain("Chat log");
  expect(offered).toBe(chat);
});

it("has the command palette offering its search input", async () => {
  const commands = (): PaletteItem[] => [
    { kind: "action", name: "Toggle theme", onSelect: () => {} },
  ];
  const offered = await offeredFocusEl(() => (
    <CommandPalette commands={commands} open onOpenChange={() => {}} />
  ));
  expect(offered).toBe(found('[data-testid="command-palette"] input'));
});

it("has the conductor help sheet offering its scrollable body", async () => {
  helpSheet.openDialog();
  const offered = await offeredFocusEl(() => (
    <Shown value={() => true}>
      <ConductorHelpSheet />
    </Shown>
  ));
  helpSheet.close();
  expect(offered).toBe(found('[data-testid="conductor-help-body"]'));
});

it("has the memory editor offering its title field", async () => {
  editMemory({ kind: "add" });
  const offered = await offeredFocusEl(() => <MemoryEditor />);
  expect(offered).toBe(found('[data-testid="memory-editor-title"]'));
});

it("has the intent editor offering its textarea", async () => {
  const [open] = createSignal(true);
  const offered = await offeredFocusEl(() => (
    <IntentEditorDialog
      open={open()}
      title="Intent"
      value=""
      onOpenChange={() => {}}
      onSave={() => {}}
    />
  ));
  expect(offered).toBe(found('[data-testid="intent-editor-textarea"]'));
});
