import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import type { ConductorState } from "kolu-common/conductor";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { recoveryOffer } from "./recovery";
import { useConductor } from "./useConductor";

const ConductorRefusal: Component<{ state: ConductorState }> = (props) => {
  const orch = useConductor();
  return (
    <div
      data-testid="conductor-refusal"
      class="border-t border-edge px-5 py-3 text-xs text-fg-2"
    >
      <p class="mb-2 whitespace-pre-wrap">{props.state.refusal}</p>
      <Show
        when={props.state.unreadable}
        fallback={
          <button
            type="button"
            data-testid="conductor-retry"
            class="rounded-md border border-edge-bright bg-surface-2 hover:bg-surface-3 px-2.5 py-1 text-fg cursor-pointer"
            onClick={() => orch.newSession()}
          >
            Try again
          </button>
        }
      >
        {(unreadable) => {
          const offer = createMemo(() => recoveryOffer(unreadable()));
          return (
            <>
              <p
                data-testid="conductor-refusal-detail"
                class="mb-3 whitespace-pre-wrap break-words text-[11px] text-fg-3"
              >
                {unreadable().detail}
              </p>
              <div class="flex max-w-lg flex-col gap-2 sm:flex-row">
                <Show when={offer().backupLabel}>
                  {(label) => (
                    <button
                      type="button"
                      data-testid="conductor-recover-backup"
                      class="flex-1 cursor-pointer rounded-lg border border-warning/50 bg-warning/20 px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-warning/30"
                      onClick={() =>
                        orch.recoverStore(unreadable().key, "backup")
                      }
                    >
                      {label()}
                    </button>
                  )}
                </Show>
                <div class="flex-1">
                  <InlineConfirmButton
                    label={offer().emptyLabel}
                    inFlightLabel={offer().emptyLabel}
                    confirmCopy={offer().emptyCopy}
                    tone="danger"
                    inFlight={false}
                    testid="conductor-recover-empty"
                    onConfirm={() =>
                      orch.recoverStore(unreadable().key, "empty")
                    }
                  />
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
};

export default ConductorRefusal;
