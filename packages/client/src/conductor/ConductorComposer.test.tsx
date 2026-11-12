// @vitest-environment happy-dom
/**
 * THE `@` MENU AND ITS CHIPS SURVIVE A FLEET TICK.
 *
 * The candidate list is minted fresh on every notification — `fleetMentionCandidates`
 * maps the whole fleet into new objects — and the fleet index notifies on ANY
 * metadata change on ANY host. So a terminal retitling itself on a machine
 * nobody is looking at wakes this composer, and a reference-keyed list would
 * tear down and rebuild every row of the open menu and every armed chip: the
 * hovered row's highlight and the chip under the finger both vanish mid-press,
 * for a change about a different machine entirely.
 *
 * These tests hold the DOM nodes across exactly that tick. Identity (`toBe` on
 * the element) is the assertion, because "re-created" is not visible in the
 * rendered text — a rebuilt row looks right and behaves wrong.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { ConductorState } from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalRow } from "../palette/fleetTerminals";
import { setComposerText } from "./drafts";
import ConductorComposer from "./ConductorComposer";

/** The index is the ONE thing this test controls: everything downstream of it
 *  — the per-host key computation, the filter, the resolve — stays real, or
 *  the test would prove only that a mock can hold a node. */
const fleet = vi.hoisted(() => ({
  read: (() => []) as Accessor<FleetTerminalRow[]>,
}));
vi.mock(import("../palette/fleetTerminals"), async (importOriginal) => ({
  ...(await importOriginal()),
  useFleetTerminalIndex: () => fleet.read,
}));
// The wire-facing neighbours, inert: this file is about node identity, and a
// real prompt verb or a real upload would only add a second thing to fail.
vi.mock("./useConductor", () => ({
  useConductor: () => ({ prompt: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("./attachFiles", () => ({
  attachPastedFiles: () => false,
  reattachComposerFiles: () => {},
}));
vi.mock("../host/hostChipTone", () => ({ hostLabel: () => "host" }));

const LOCAL: HostKey = { kind: "local" };
const REMOTE: HostKey = { kind: "remote", target: "srid@builder" };

const meta = (branch: string, intent: string): TerminalMetadata =>
  ({
    state: "active",
    cwd: "/home/srid/code/kolu",
    git: { kind: "repo", info: { repoName: "kolu", branch } },
    intent,
  }) as unknown as TerminalMetadata;

const row = (
  host: HostKey,
  id: string,
  branch: string,
  intent: string,
): FleetTerminalRow => ({
  host,
  id: id as TerminalId,
  meta: meta(branch, intent),
  recencyAt: 1_000,
});

/** Both hosts carry a terminal; the REMOTE one is the one that moves. */
const here = () =>
  row(LOCAL, "aaaaaaaa-0000-4000-8000-000000000001", "alpha", "here");
const there = (intent: string) =>
  row(REMOTE, "bbbbbbbb-0000-4000-8000-000000000002", "beta", intent);

const STATE = {
  phase: "idle",
  commands: [],
} as unknown as ConductorState;

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  setComposerText("");
});

/** Mount the composer over a fleet whose rows the caller can move, and put
 *  `text` in the box with the caret at its end — the input event is how the
 *  component learns where the caret is, so the menu opens the way a typed `@`
 *  opens it rather than by poking at internals. */
function mount(text: string): {
  readonly el: HTMLElement;
  readonly tick: (rows: FleetTerminalRow[]) => void;
} {
  const [rows, setRows] = createSignal<FleetTerminalRow[]>([
    here(),
    there("first"),
  ]);
  fleet.read = rows;
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <ConductorComposer state={STATE} />, root);
  const box = root.querySelector<HTMLTextAreaElement>(
    '[data-testid="conductor-input"]',
  );
  if (box === null) throw new Error("the composer did not render its box");
  box.value = text;
  box.setSelectionRange(text.length, text.length);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return { el: root, tick: setRows };
}

const rowsIn = (el: HTMLElement, testId: string): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];

describe("the `@` menu across a fleet tick", () => {
  it("keeps every candidate row's node when an UNRELATED host's terminal changes", () => {
    const { el, tick } = mount("@");
    const before = rowsIn(el, "conductor-mention-row");
    expect(before.map((node) => node.dataset.terminalId)).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000001",
      "bbbbbbbb-0000-4000-8000-000000000002",
    ]);

    // The remote host retitles a terminal: a new row array, new row objects,
    // new candidate objects — the whole fleet notification, as it arrives.
    tick([here(), there("second")]);

    const after = rowsIn(el, "conductor-mention-row");
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    // …and the retained node is LIVE, not frozen: the host that moved shows
    // its new intent inside the very node that was kept.
    expect(after[1]?.textContent).toContain("second");
  });

  it("keeps an armed chip's node across the same tick", () => {
    const { el, tick } = mount("@alpha ");
    const before = rowsIn(el, "conductor-mention-chip");
    expect(before).toHaveLength(1);

    tick([here(), there("second")]);

    const after = rowsIn(el, "conductor-mention-chip");
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before[0]);
  });
});
