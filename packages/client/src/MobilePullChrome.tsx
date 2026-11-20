import Drawer from "@corvu/drawer";
import { type Component, Show } from "solid-js";
import { useConductorBadge } from "./conductor/useConductorFacts";
import { conductorMode } from "./conductor/useConductorMode";
import MobileChromeSheet from "./MobileChromeSheet";
import type { WsStatus } from "./rpc/rpc";
import { TerminalMetaCompact } from "./terminal/TerminalMeta";
import { pairDisplayRow } from "./terminal/terminalDisplay";
import { useTerminalStore } from "./terminal/useTerminalStore";
import {
  chromeDrawerOpen as chromeOpen,
  setChromeDrawerOpen as setChromeOpen,
} from "./useChromeDrawer";
import { withKeyboardDismiss } from "./ui/dismissSoftKeyboard";
import { clientStale, StaleBadge } from "./ui/StaleBadge";

const PULL_OPEN_THRESHOLD = 24;
/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]`, but on the mouse-click open
 *  path it reads the signal before the default attaches and trips a
 *  reactive-ordering bug (#977). Passing the value explicitly sidesteps it;
 *  touch-driven opens hit a different code path and never trip the bug. Delete
 *  on the Corvu upgrade that fixes #977. */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const MobilePullChrome: Component<{
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const badge = useConductorBadge();
  const onChromeOpenChange = withKeyboardDismiss(setChromeOpen);
  let pullStartY: number | null = null;

  const activeRow = () => {
    const id = store.activeId();
    return id !== null
      ? pairDisplayRow(store.getDisplayInfo(id), store.getMetadata(id))
      : null;
  };

  return (
    <>
      <button
        type="button"
        data-testid="mobile-pull-handle"
        class="flex flex-col items-center gap-1 px-3 py-1.5 shrink-0 border-b border-edge bg-surface-1 cursor-pointer active:bg-surface-2 transition-colors"
        aria-label="Open navigation"
        onClick={() => setChromeOpen(true)}
        onTouchStart={(e: TouchEvent) => {
          e.stopPropagation();
          const t = e.touches[0];
          pullStartY = t ? t.clientY : null;
        }}
        onTouchMove={(e: TouchEvent) => {
          if (pullStartY === null || chromeOpen()) return;
          const t = e.touches[0];
          if (!t) return;
          if (t.clientY - pullStartY >= PULL_OPEN_THRESHOLD) {
            // preventDefault suppresses the synthesized click that would
            // otherwise re-toggle the drawer closed.
            e.preventDefault();
            setChromeOpen(true);
            pullStartY = null;
          }
        }}
        onTouchEnd={() => {
          pullStartY = null;
        }}
      >
        <span class="w-16 h-2 rounded-full bg-fg-3/40" aria-hidden="true" />
        <div class="flex items-center gap-2 w-full">
          <Show
            when={!conductorMode()}
            fallback={
              <span
                data-testid="mobile-handle-conductor"
                class="flex items-center gap-1.5 text-sm font-medium text-accent"
              >
                <span aria-hidden="true">◆</span>
                Conductor
              </span>
            }
          >
            <Show
              when={activeRow()}
              fallback={<span class="text-sm text-fg-2">kolu</span>}
            >
              {(row) => (
                <div data-testid="mobile-tile-titlebar" class="flex-1 min-w-0">
                  <TerminalMetaCompact info={row().info} meta={row().meta} />
                </div>
              )}
            </Show>
          </Show>
          <Show when={clientStale()}>
            <div data-testid="mobile-stale-badge" class="ml-auto shrink-0">
              <StaleBadge />
            </div>
          </Show>
          <Show when={badge.waiting() > 0}>
            <span
              data-testid="mobile-handle-needs-you"
              data-waiting={badge.waiting()}
              class="shrink-0 min-w-5 rounded-full bg-alert px-1.5 text-center text-[0.68rem] font-semibold leading-5 text-surface-0"
              classList={{ "ml-auto": !clientStale() }}
            >
              {badge.waiting()}
            </span>
          </Show>
        </div>
      </button>

      <Drawer
        side="top"
        open={chromeOpen()}
        onOpenChange={onChromeOpenChange}
        snapPoints={CORVU_SNAP_WORKAROUND}
        // Keep Corvu from restoring focus to the terminal textarea on close;
        // `onChromeOpenChange` then actively blurs it. restoreFocus={false}
        // stops Corvu re-summoning the keyboard, and the blur drops a keyboard
        // iOS left lingering while the drawer was open. See `dismissSoftKeyboard`.
        restoreFocus={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            data-testid="mobile-chrome-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content class="fixed top-0 left-0 right-0 z-50 bg-surface-1 border-b border-edge shadow-xl max-h-[70vh] overflow-y-auto">
            <MobileChromeSheet
              status={props.status}
              appTitle={props.appTitle}
              onOpenPalette={props.onOpenPalette}
              onClose={() => onChromeOpenChange(false)}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

export default MobilePullChrome;
