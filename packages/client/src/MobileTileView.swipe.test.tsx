// @vitest-environment happy-dom
/** The swipe gesture on the mobile tile pane: a touchstart/touchend pair far
 *  enough apart horizontally cycles the active tile. The e2e feature drives
 *  this through synthesized `Touch` events; here the same pair is dispatched
 *  on the wrapper so the handler's own arithmetic and the store call it makes
 *  are covered without a browser. */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const B = "22222222-2222-4222-8222-222222222222" as TerminalId;

const seam = vi.hoisted(() => ({
  active: null as string | null,
  landed: [] as string[],
}));

vi.mock("./canvas/dock/DockList", () => ({ DockList: () => null }));
vi.mock("./terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    activeId: () => seam.active,
    setActiveSilently: (id: string) => {
      seam.landed.push(id);
      seam.active = id;
    },
    focusTerminalSilently: () => {},
  }),
}));
vi.mock("./tile/useTileStore", () => ({
  useTileStore: () => ({ isActiveTile: (id: string) => id === seam.active }),
}));

import MobileTileView from "./MobileTileView";
import { Shown } from "./ui/shown";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
  seam.active = null;
  seam.landed.length = 0;
});

function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  disposers.push(
    render(
      () => (
        <Shown value={() => true}>
          <MobileTileView
            orderedIds={[A, B]}
            renderBody={(id) => <div data-body={id} />}
            hideDockDrawer
          />
        </Shown>
      ),
      root,
    ),
  );
  const view = root.querySelector<HTMLElement>(
    '[data-testid="mobile-tile-view"]',
  );
  if (!view) throw new Error("mobile tile view did not render");
  return view;
}

/** happy-dom has no `Touch`/`TouchEvent` constructor, so the pair is a plain
 *  bubbling `Event` carrying the touch lists the handler reads. */
function touch(type: string, x: number, list: "touches" | "changedTouches") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const points = [{ clientX: x, clientY: 100 }];
  Object.defineProperty(event, "touches", {
    value: list === "touches" ? points : [],
  });
  Object.defineProperty(event, "changedTouches", { value: points });
  return event;
}

function swipe(view: HTMLElement, dx: number) {
  view.dispatchEvent(touch("touchstart", 200, "touches"));
  view.dispatchEvent(touch("touchend", 200 + dx, "changedTouches"));
}

it("cycles the active tile on a leftward swipe", () => {
  seam.active = B;
  const view = mount();
  swipe(view, -200);
  expect(seam.landed).toEqual([A]);
});

it("cycles the active tile on a rightward swipe", () => {
  seam.active = B;
  const view = mount();
  swipe(view, 200);
  expect(seam.landed).toEqual([A]);
});

it("ignores a gesture shorter than the swipe threshold", () => {
  seam.active = B;
  const view = mount();
  swipe(view, -20);
  expect(seam.landed).toEqual([]);
});
