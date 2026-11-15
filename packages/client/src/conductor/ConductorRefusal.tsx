/**
 * THE PANEL UNDER A CONDUCTOR THAT WOULD NOT COME UP — the sentence, and what
 * can be done about it.
 *
 * TWO REFUSALS, two offers, because they are two different situations:
 *
 *  - THE AGENT SAID NO (a missing socket, an adapter that would not start, a
 *    session it refused). The one thing to offer is asking again for exactly
 *    what was refused: *Try again*.
 *  - A RECORD KOLU COULD NOT READ. There is no agent in this one — the
 *    conversation never got as far as starting — so *Try again* would ask the
 *    same file the same question and get the same answer. What is offered
 *    instead is the two things kolu can actually DO (`recovery.ts` holds the
 *    copy): restore the newest state backup that reads, or start with that
 *    record empty and the unreadable value kept aside in a file of its own.
 *
 * WHAT IS NEVER OFFERED is the thing this panel used to say: "Fix the `works`
 * key to recover." A person whose Conductor will not come up is not holding a
 * JSON editor, and kolu knowing exactly what is wrong and telling them to go
 * and fix it by hand is kolu handing back its own job.
 */

import type { Component } from "solid-js";
import { Show } from "solid-js";
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
        {(unreadable) => (
          <>
            {/* What the decode tripped on, small: the one line a bug report
                needs, and the one line nobody has to understand to use the
                two buttons under it. */}
            <p
              data-testid="conductor-refusal-detail"
              class="mb-3 whitespace-pre-wrap break-words text-[11px] text-fg-3"
            >
              {unreadable().detail}
            </p>
            <div class="flex max-w-lg flex-col gap-2 sm:flex-row">
              <Show when={recoveryOffer(unreadable()).backupLabel}>
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
              {/* The destructive-looking half, behind the repo's one confirm
                  shell — and the confirm NAMES the file the unreadable value
                  is kept in, because "nothing is deleted" is a promise and a
                  path is a fact. */}
              <div class="flex-1">
                <InlineConfirmButton
                  label={recoveryOffer(unreadable()).emptyLabel}
                  inFlightLabel={recoveryOffer(unreadable()).emptyLabel}
                  confirmCopy={recoveryOffer(unreadable()).emptyCopy}
                  tone="danger"
                  inFlight={false}
                  testid="conductor-recover-empty"
                  onConfirm={() => orch.recoverStore(unreadable().key, "empty")}
                />
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default ConductorRefusal;
