import type { Membership } from "kolu-work";
import {
  type Component,
  createEffect,
  createMemo,
  onCleanup,
  Show,
} from "solid-js";
import { dismissLockCard, lockCardShown } from "./personInput";
import { useConductor } from "./useConductor";
import { useMembership } from "./useWorks";
import { lockCardWords, type Lock, lockWords } from "./workReadings";

const BUTTON_CLASS =
  "shrink-0 rounded-sm px-2 py-[0.2rem] font-mono text-[0.62rem] font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const dismissOnCapturedEscapeOrOutside = (
  card: () => HTMLDivElement | undefined,
  dismiss: () => void,
): void => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  };
  const onDown = (e: Event) => {
    const target = e.target;
    if (target instanceof Node && card()?.contains(target)) return;
    dismiss();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDown, true);
  onCleanup(() => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
  });
};

const WorkLock: Component<{
  terminal: string;
}> = (props) => {
  const membership = useMembership();
  const conductor = useConductor();
  const driven = createMemo(
    (): (Membership & { readonly driver: Lock }) | undefined => {
      const at = membership().get(props.terminal);
      if (at === undefined || at.driver === "nobody") return undefined;
      return { ...at, driver: at.driver };
    },
  );
  const carded = () => driven() !== undefined && lockCardShown(props.terminal);

  let card: HTMLDivElement | undefined;

  createEffect(() => {
    if (!carded()) return;
    dismissOnCapturedEscapeOrOutside(() => card, dismissLockCard);
  });

  return (
    <Show when={driven()}>
      {(at) => (
        <>
          <div
            data-testid="work-lock"
            data-lock-terminal={props.terminal}
            data-driver={at().driver}
            data-work={at().work}
            data-role={at().role}
            aria-hidden="true"
            class={`pointer-events-none absolute inset-0 z-10 border-2 ${
              at().driver === "you" ? "border-alert/70" : "border-conductor/60"
            }`}
          />
          <Show when={at().driver === "you"}>
            <button
              type="button"
              data-testid="work-hand-back"
              data-lock-terminal={props.terminal}
              title={lockWords(at(), at().driver)}
              class={`${BUTTON_CLASS} absolute bottom-2 left-2 z-20 flex items-center gap-1.5 border border-alert/40 bg-surface-1/95 text-alert shadow-md hover:bg-alert/15`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                conductor.handBack(props.terminal);
              }}
            >
              <span class="normal-case font-normal text-fg-2">
                You’re driving
              </span>
              <span aria-hidden="true" class="text-fg-3">
                ·
              </span>
              <span>Hand back</span>
            </button>
          </Show>
          <Show when={carded()}>
            <div class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-3">
              <div
                ref={card}
                data-testid="work-lock-card"
                data-lock-terminal={props.terminal}
                data-work={at().work}
                data-role={at().role}
                role="status"
                class="pointer-events-auto flex max-w-[22rem] flex-col gap-2 rounded-md border border-conductor/40 bg-surface-1/97 px-3 py-2 shadow-xl"
              >
                <span class="font-mono text-[0.68rem] leading-snug text-fg-1">
                  {lockCardWords(at())}
                </span>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    data-testid="work-lock-dismiss"
                    class={`${BUTTON_CLASS} text-fg-3 hover:bg-surface-2`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissLockCard();
                    }}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    data-testid="work-take-over"
                    class={`${BUTTON_CLASS} bg-conductor/20 text-conductor hover:bg-conductor/30`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissLockCard();
                      conductor.takeOver(props.terminal);
                    }}
                  >
                    Take over
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </>
      )}
    </Show>
  );
};

export default WorkLock;
