import { batch, type Component, createMemo, Show } from "solid-js";
import { setActivityWindow } from "../../terminal/activityWindowFilter";
import { setShowSleeping } from "../../terminal/showSleeping";
import { ActivityWindowChip } from "../../ui/ActivityWindowChip";
import { DOCK_CARDS_GUTTER_CLASS } from "@kolu/solid-dockrow/rowValues";
import { SleepingToggle } from "../../ui/SleepingToggle";

export type DockFooterSurface = "rail" | "cards" | "touch";

const CHIP_SHELL = "rounded-md hover:bg-surface-2/70";

type FooterChrome = {
  testId: string;
  windowPrefix: "dock-window" | "mobile-dock-window";
  sleepingPrefix: "dock-sleeping" | "mobile-dock-sleeping";
  chipClass: string;
  padClass: string;
};

const FOOTER_CHROME: Record<DockFooterSurface, FooterChrome> = {
  rail: {
    testId: "dock-hidden-footer",
    windowPrefix: "dock-window",
    sleepingPrefix: "dock-sleeping",
    chipClass: `${CHIP_SHELL} h-5 min-w-5 px-1 text-[0.6rem] leading-none`,
    padClass: "",
  },
  cards: {
    testId: "dock-hidden-footer",
    windowPrefix: "dock-window",
    sleepingPrefix: "dock-sleeping",
    chipClass: `${CHIP_SHELL} h-5 min-w-5 px-1 text-[0.65rem]`,
    padClass: `pl-3 ${DOCK_CARDS_GUTTER_CLASS} py-2 text-[0.65rem]`,
  },
  touch: {
    testId: "mobile-dock-hidden-footer",
    windowPrefix: "mobile-dock-window",
    sleepingPrefix: "mobile-dock-sleeping",
    chipClass: `${CHIP_SHELL} h-6 min-w-6 px-1.5 text-[0.75rem]`,
    padClass: "px-3 py-3 text-[0.75rem]",
  },
};

export const HiddenFooter: Component<{
  hiddenCount: number;
  sleepingCount: number;
  surface: DockFooterSurface;
}> = (props) => {
  const showReset = createMemo(() => props.hiddenCount > 0);
  const resetAll = () =>
    batch(() => {
      setActivityWindow("all");
      setShowSleeping(true);
    });
  const chrome = (): FooterChrome => FOOTER_CHROME[props.surface];
  return (
    <Show
      when={props.surface === "rail"}
      fallback={
        <CardsLayout
          chrome={chrome()}
          sleepingCount={props.sleepingCount}
          hiddenCount={props.hiddenCount}
          showReset={showReset}
          resetAll={resetAll}
        />
      }
    >
      <div
        data-testid={chrome().testId}
        data-layout="rail"
        class="flex flex-col items-center gap-1 border-t border-edge/40 py-2 text-fg-3"
      >
        <Show when={showReset()}>
          <button
            type="button"
            data-testid="dock-hidden-show-all"
            onClick={resetAll}
            class="tabular-nums text-[0.6rem] leading-none text-accent cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={`${props.hiddenCount} terminals hidden by dock filters — show all`}
            title={`${props.hiddenCount} hidden by filters — show all`}
          >
            <span aria-hidden="true">{props.hiddenCount}</span>
          </button>
        </Show>
        <ActivityWindowChip
          anchor="top-start"
          testIdPrefix={chrome().windowPrefix}
          class={chrome().chipClass}
        />
        <Show when={props.sleepingCount > 0}>
          <SleepingToggle
            count={props.sleepingCount}
            testIdPrefix={chrome().sleepingPrefix}
            class={chrome().chipClass}
          />
        </Show>
      </div>
    </Show>
  );
};

const CardsLayout: Component<{
  chrome: FooterChrome;
  sleepingCount: number;
  hiddenCount: number;
  showReset: () => boolean;
  resetAll: () => void;
}> = (props) => (
  <div
    data-testid={props.chrome.testId}
    data-layout="cards"
    class={`flex items-center gap-1.5 border-t border-edge/40 text-fg-3 text-left ${props.chrome.padClass}`}
  >
    <span class="uppercase tracking-[0.14em] text-[0.85em] text-fg-3 select-none">
      Filters
    </span>
    <ActivityWindowChip
      anchor="top-start"
      testIdPrefix={props.chrome.windowPrefix}
      class={props.chrome.chipClass}
    />
    <Show when={props.sleepingCount > 0}>
      <SleepingToggle
        count={props.sleepingCount}
        testIdPrefix={props.chrome.sleepingPrefix}
        class={props.chrome.chipClass}
      />
    </Show>
    <Show when={props.showReset()}>
      <div class="ml-auto flex items-center gap-1.5 tabular-nums shrink-0">
        <span>{props.hiddenCount} hidden</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          data-testid="dock-hidden-show-all"
          onClick={props.resetAll}
          class="text-accent cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          title="Show every terminal — clears the activity window and un-hides sleeping"
        >
          show all
        </button>
      </div>
    </Show>
  </div>
);
