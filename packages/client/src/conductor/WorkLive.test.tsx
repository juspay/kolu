// @vitest-environment happy-dom
/**
 * THE PICKED WORK'S TERMINALS, PANE BY PANE.
 *
 * A pane is drawn for a member this browser can resolve, keyed by its
 * terminal's ref, and it holds that terminal's screen. The two things this
 * pins are what a scrolled-back reader depends on:
 *
 * - the view's reads are REACTIVE reads. A flow child and a component body
 *   are strict-read windows under Solid 2, so a read made there is frozen and
 *   the dev lane says so; mounting under `@kolu/solid-test-setup` fails on the
 *   diagnostic.
 * - a member's row moving does not redraw its pane. The row is read again
 *   whenever a terminal's state moves, and a pane redrawn on each of those
 *   would drop its screen and read it again from the start.
 */

import type { TerminalId } from "kolu-common/surface";
import type { WorkRole } from "kolu-work";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberLine } from "./workFacts";
import { Shown } from "../ui/shown";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const OTHER = "22222222-2222-4222-8222-222222222222" as TerminalId;
// Wide enough for two panes side by side, or not: the view stacks its panes
// on a wide window and tabs them on a narrow one, and each branch hands a
// pane its terminal its own way.
const [wide, setWide] = createSignal(true);
vi.mock("@solid-primitives/media", () => ({
  createMediaQuery: () => () => wide(),
}));
// The pane itself is stood in for: what it draws is its own test
// (`LivePane.test.tsx`). What matters here is WHICH terminal each pane is
// handed, and whether its element survives a members rebuild. Every prop is
// read in JSX, so the stand-in is not itself a frozen read.
vi.mock("./LivePane", () => ({
  default: (props: {
    host: string;
    id: string;
    role: WorkRole;
    connected: boolean;
    tabs?: unknown;
  }) => (
    <section
      data-testid="live-pane"
      data-ref={`${props.host}/${props.id}`}
      data-role={props.role}
      data-connected={props.connected ? "" : undefined}
    >
      {props.tabs as never}
    </section>
  ),
}));
vi.mock("./MemberPip", () => ({ default: () => null }));
vi.mock("./memberNames", () => ({ useMemberName: () => () => "member" }));
import WorkLive from "./WorkLive";

const line = (
  host: string,
  id: TerminalId,
  role: WorkRole,
  tag: string,
): MemberLine => ({
  terminal: `${host}/${id}`,
  // A fresh object every call: the members memo hands a new row out whenever
  // the terminal's record moves, which is what the view must not redraw on.
  member: { work: "w1", role, joinedAt: tag } as never,
  split: { host, id },
  standing: { kind: "here", meta: { state: "active" } as never },
});

const [members, setMembers] = createSignal<ReadonlyArray<MemberLine>>([]);

const disposers: Array<() => void> = [];

const mount = (): HTMLElement => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Shown value={() => true}>
        <WorkLive members={members()} />
      </Shown>
    ),
    root,
  );
  disposers.push(() => {
    dispose();
    root.remove();
  });
  return root;
};
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  setMembers([]);
  setWide(true);
});

const panesIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-testid="live-pane"]'));

describe("the panes a picked work draws", () => {
  it("hands each stacked pane its own terminal", () => {
    setMembers([
      line("local", ID, "planner", "a"),
      line("local", OTHER, "implementor", "a"),
    ]);
    const el = mount();
    flush();
    expect(panesIn(el).map((p) => p.getAttribute("data-ref"))).toEqual([
      `local/${ID}`,
      `local/${OTHER}`,
    ]);
    expect(panesIn(el).map((p) => p.getAttribute("data-role"))).toEqual([
      "planner",
      "implementor",
    ]);
  });

  it("hands the tabbed pane the terminal of the tab in front", () => {
    setWide(false);
    setMembers([
      line("local", ID, "planner", "a"),
      line("local", OTHER, "implementor", "a"),
    ]);
    const el = mount();
    flush();
    expect(panesIn(el).map((p) => p.getAttribute("data-ref"))).toEqual([
      `local/${ID}`,
    ]);

    el.querySelector<HTMLButtonElement>(
      `[data-testid="live-tab"][data-ref="local/${OTHER}"]`,
    )?.click();
    flush();
    expect(panesIn(el).map((p) => p.getAttribute("data-ref"))).toEqual([
      `local/${OTHER}`,
    ]);
  });

  it("keeps a pane's element when its member's row moves", () => {
    setMembers([line("local", ID, "implementor", "a")]);
    const el = mount();
    flush();
    const was = panesIn(el)[0];
    expect(was).toBeDefined();

    // The same member, read again: a new row object, a new line object, the
    // same terminal. Its screen must not be dropped and read from the start.
    setMembers([line("local", ID, "implementor", "b")]);
    flush();
    expect(panesIn(el)).toEqual([was]);
    expect(was?.getAttribute("data-role")).toBe("implementor");
  });

  it("draws one pane per terminal when a ref arrives twice", () => {
    // THE SAME TERMINAL, TWICE in the work's member lines — two rows naming
    // one terminal, as a membership read mid-rebuild can hand over. One
    // terminal is one screen: a second pane over the same ref would attach
    // the stream twice and the readouts would match two elements.
    setMembers([
      line("local", ID, "implementor", "a"),
      line("local", ID, "implementor", "b"),
    ]);
    const el = mount();
    flush();
    expect(panesIn(el).map((p) => p.getAttribute("data-ref"))).toEqual([
      `local/${ID}`,
    ]);

    // AND AFTER A RE-PICK: the rows are read again, with the duplicate still
    // in them. Still one pane, and the SAME element.
    const was = panesIn(el)[0];
    setMembers([
      line("local", ID, "implementor", "c"),
      line("local", ID, "implementor", "d"),
    ]);
    flush();
    expect(panesIn(el)).toEqual([was]);
  });

  it("draws one pane per terminal when a tabbed work holds a ref twice", () => {
    setWide(false);
    setMembers([
      line("local", ID, "planner", "a"),
      line("local", ID, "planner", "b"),
      line("local", OTHER, "implementor", "a"),
    ]);
    const el = mount();
    flush();
    expect(
      el.querySelectorAll(`[data-testid="live-tab"][data-ref="local/${ID}"]`),
    ).toHaveLength(1);
    expect(panesIn(el).map((p) => p.getAttribute("data-ref"))).toEqual([
      `local/${ID}`,
    ]);
  });
});
