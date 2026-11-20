import Drawer from "@corvu/drawer";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createSignal, For, type JSX, Show } from "solid-js";
import { DockList } from "./canvas/dock/DockList";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { useTileStore } from "./tile/useTileStore";
import { withKeyboardDismiss } from "./ui/dismissSoftKeyboard";

const SWIPE_THRESHOLD = 60;
const VERTICAL_TOLERANCE_RATIO = 0.7;
/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]`, but on the mouse-click
 *  open path it reads the signal before the default attaches and trips a
 *  reactive-ordering bug (#977). Passing the value explicitly sidesteps it;
 *  touch-driven opens hit a different code path and never trip the bug. Used by
 *  the dock drawer below (the chrome drawer moved to `MobilePullChrome`, which
 *  carries its own copy) — delete on the Corvu upgrade that fixes #977. */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const MobileTileView: Component<{
  orderedIds: TerminalId[];
  renderBody: (id: TerminalId, visible: () => boolean) => JSX.Element;
  bottomBar?: JSX.Element;
  hideDockDrawer?: boolean;
}> = (props) => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const [touchStart, setTouchStart] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  const [dockOpen, setDockOpen] = createSignal(false);
  const onDockOpenChange = withKeyboardDismiss(setDockOpen);

  function navigate(direction: 1 | -1) {
    const ids = props.orderedIds;
    const active = store.activeId();
    if (ids.length < 2 || active === null) return;
    const idx = ids.indexOf(active);
    if (idx === -1) return;
    const next = (idx + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target) store.setActiveSilently(target);
  }

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    setTouchStart({ x: t.clientX, y: t.clientY });
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchStart();
    setTouchStart(null);
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_TOLERANCE_RATIO) return;
    navigate(dx < 0 ? 1 : -1);
  }

  return (
    <>
      <div
        data-testid="mobile-tile-view"
        class="flex-1 min-h-0 flex flex-col relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <Show when={!props.hideDockDrawer}>
          <button
            type="button"
            data-testid="mobile-dock-handle"
            class="group absolute top-1/2 left-0 -translate-y-1/2 z-10 flex h-16 w-8 items-center justify-start cursor-pointer"
            aria-label="Open dock"
            onClick={() => setDockOpen(true)}
            onTouchStart={(e: TouchEvent) => e.stopPropagation()}
          >
            <span
              aria-hidden="true"
              class="h-16 w-2 rounded-r bg-fg-3/30 transition-colors group-active:bg-fg-3/60"
            />
          </button>
        </Show>

        <div class="flex-1 min-h-0 relative overflow-hidden">
          <For each={props.orderedIds}>
            {(id) => {
              const visible = () => tileStore.isActiveTile(id);
              return (
                <div
                  data-mobile-tile={id}
                  data-active={visible() ? "" : undefined}
                  class="absolute inset-0 flex flex-col"
                  style={{
                    "content-visibility": visible() ? "visible" : "hidden",
                  }}
                  inert={!visible()}
                >
                  {props.renderBody(id, visible)}
                </div>
              );
            }}
          </For>
        </div>
        {props.bottomBar}
      </div>

      <Show when={!props.hideDockDrawer}>
        <Drawer
          side="left"
          open={dockOpen()}
          onOpenChange={onDockOpenChange}
          snapPoints={CORVU_SNAP_WORKAROUND}
          // See the chrome drawer above: restoreFocus={false} keeps Corvu from
          // re-summoning the keyboard, `onDockOpenChange` blurs the field to drop
          // a keyboard left lingering. Covers both dismiss paths — backdrop tap
          // (Corvu's onOpenChange) and selecting a terminal row (onClose below).
          restoreFocus={false}
        >
          <Drawer.Portal>
            <Drawer.Overlay
              data-testid="mobile-dock-backdrop"
              class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
            />
            <Drawer.Content class="fixed top-0 left-0 bottom-0 z-50 w-[78vw] max-w-[20rem] bg-surface-1 border-r border-edge shadow-xl">
              <div data-testid="mobile-dock-sheet" class="flex flex-col h-full">
                <DockList
                  onSelect={(id) => {
                    store.focusTerminalSilently(id);
                    onDockOpenChange(false);
                  }}
                />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer>
      </Show>
    </>
  );
};

export default MobileTileView;
